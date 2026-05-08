import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, addDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const identificador = urlParams.get('negocio'); // UID o slug

if (!identificador) {
    alert('No se especificó un negocio. Contacta al administrador.');
    window.location.href = 'index.html';
}

// Variables globales
let negocioId = null;
let datosNegocio = {};
let servicioSeleccionado = null;
let empleadoSeleccionado = null;
let fechaSeleccionada = null;
let horarioSeleccionado = null;
let miniCalendario = null;
let cargandoHorarios = false;   // Bandera para el timeout (solución al bug #3)

const pasos = document.querySelectorAll('.paso');
let pasoActual = 0;

// Utilidad para cambiar de paso
function mostrarPaso(indice) {
    pasos.forEach(p => p.classList.remove('activo'));
    pasos[indice].classList.add('activo');
    pasoActual = indice;
}

// ==================== BUSCAR NEGOCIO ====================
async function cargarNegocio() {
    try {
        // 1. Intentar como UID directo
        let snap = await getDoc(doc(db, 'negocios', identificador));
        if (snap.exists()) {
            negocioId = identificador;
            procesarNegocio(snap.data());
            return;
        }

        // 2. Buscar por slug
        const q = query(collection(db, 'negocios'), where('slug', '==', identificador));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
            negocioId = querySnap.docs[0].id;
            procesarNegocio(querySnap.docs[0].data());
        } else {
            alert('Negocio no encontrado. Verifica el enlace.');
            window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Error al buscar negocio:', error);
        alert('No se pudo conectar con el servidor. Revisa tu conexión o el enlace.');
    }
}

function procesarNegocio(data) {
    datosNegocio = data;
    document.getElementById('nombre-negocio').textContent = data.nombre || 'Negocio';
    document.getElementById('logo-img').src = data.logoURL || '';
    document.getElementById('portada-img').src = data.portadaURL || '';
    cargarServicios();
    cargarEmpleados();
}

// ==================== SERVICIOS ====================
async function cargarServicios() {
    const container = document.getElementById('lista-servicios');
    container.innerHTML = '';
    try {
        const snap = await getDocs(collection(db, 'negocios', negocioId, 'servicios'));
        snap.forEach(doc => {
            const s = doc.data();
            const card = document.createElement('div');
            card.className = 'servicio-card';
            card.dataset.id = doc.id;
            card.dataset.duracion = s.duracion;
            card.innerHTML = `<div class="nombre">${s.nombre}</div>
                              <div class="detalles">${s.duracion} min · $${s.precio}</div>`;
            card.addEventListener('click', () => {
                document.querySelectorAll('.servicio-card').forEach(c => c.classList.remove('seleccionado'));
                card.classList.add('seleccionado');
                servicioSeleccionado = { id: doc.id, ...s };
                document.getElementById('btn-siguiente').disabled = false;
            });
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error al cargar servicios:', error);
        container.innerHTML = '<p>Error al cargar servicios.</p>';
    }
}

// ==================== EMPLEADOS ====================
async function cargarEmpleados() {
    const container = document.getElementById('lista-empleados');
    // Limpiar manteniendo solo el "Cualquiera"
    container.querySelectorAll('.empleado-card:not([data-id=""])').forEach(c => c.remove());

    const cualquiera = container.querySelector('.empleado-card[data-id=""]');
    cualquiera.classList.add('seleccionado');
    cualquiera.onclick = () => {
        document.querySelectorAll('.empleado-card').forEach(c => c.classList.remove('seleccionado'));
        cualquiera.classList.add('seleccionado');
        empleadoSeleccionado = null;
    };

    try {
        const snap = await getDocs(collection(db, 'negocios', negocioId, 'empleados'));
        snap.forEach(doc => {
            const e = doc.data();
            const card = document.createElement('div');
            card.className = 'empleado-card seleccionable';
            card.dataset.id = doc.id;
            card.textContent = e.nombre;
            card.addEventListener('click', () => {
                document.querySelectorAll('.empleado-card').forEach(c => c.classList.remove('seleccionado'));
                card.classList.add('seleccionado');
                empleadoSeleccionado = { id: doc.id, ...e };
            });
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error al cargar empleados:', error);
    }
}

// ==================== MINI CALENDARIO ====================
function inicializarCalendario() {
    if (miniCalendario) return;
    const calendarEl = document.getElementById('mini-calendario');
    miniCalendario = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'es',
        height: 'auto',
        headerToolbar: { left: 'prev', center: 'title', right: 'next' },
        selectable: false,
        dayCellDidMount: (info) => {
            // SOLUCIÓN BUG #2: usamos info.dateStr y forzamos una hora local para evitar
            // desplazamientos UTC en Safari móvil.
            const fechaLocal = new Date(info.dateStr + 'T12:00:00');
            const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fechaLocal.getDay()];
            const horario = datosNegocio.horario || {};
            const config = horario[diaSem] || { abierto: true };
            if (!config.abierto) {
                info.el.classList.add('dia-no-laborable');
                info.el.style.pointerEvents = 'none';
            }
        },
        dateClick: async (info) => {
            // SOLUCIÓN BUG #2: usamos la misma técnica para verificar el día laborable.
            const fechaLocal = new Date(info.dateStr + 'T12:00:00');
            const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fechaLocal.getDay()];
            const config = (datosNegocio.horario || {})[diaSem] || { abierto: true };
            if (!config.abierto) {
                alert('Lo sentimos, no laboramos este día.');
                return;
            }
            // Solo permitir fechas desde hoy
            const hoy = new Date();
            hoy.setHours(0,0,0,0);
            if (fechaLocal < hoy) {
                alert('No puedes seleccionar una fecha pasada.');
                return;
            }
            fechaSeleccionada = info.dateStr;
            await cargarHorariosDisponibles(fechaSeleccionada);
            document.getElementById('btn-siguiente-paso3').disabled = true;
        }
    });
    miniCalendario.render();
}

// ==================== HORARIOS DISPONIBLES ====================
async function cargarHorariosDisponibles(fechaStr) {
    const slotsContainer = document.getElementById('slots-horarios');
    
    // Limpiar cualquier operación anterior
    if (cargandoHorarios) {
        // Ya hay una carga en curso, no hacemos nada o podríamos cancelarla
        // Por simplicidad, no encolamos.
        return;
    }
    cargandoHorarios = true;
    horarioSeleccionado = null;
    document.getElementById('btn-siguiente-paso3').disabled = true;

    // Mostrar spinner
    slotsContainer.innerHTML = '<div class="spinner"></div> Buscando horarios...';

    // Timeout de seguridad (12 segundos) - SOLUCIÓN BUG #3 con bandera
    const timeoutId = setTimeout(() => {
        if (cargandoHorarios) {
            slotsContainer.innerHTML = `
                <p style="color: #b91c1c;">No se pudieron cargar los horarios. 
                <button id="retry-horarios" style="color: #4f46e5; text-decoration: underline; background: none; border: none; cursor: pointer;">Reintentar</button></p>`;
            document.getElementById('retry-horarios')?.addEventListener('click', () => {
                cargarHorariosDisponibles(fechaStr);
            });
            cargandoHorarios = false;
        }
    }, 12000);

    try {
        if (!servicioSeleccionado) {
            slotsContainer.innerHTML = 'Selecciona un servicio primero.';
            cargandoHorarios = false;
            clearTimeout(timeoutId);
            return;
        }
        const duracion = servicioSeleccionado.duracion; // minutos

        // Obtener jornada del día seleccionado (fecha local)
        const fecha = new Date(fechaStr + 'T12:00:00'); // mediodía para evitar problemas de zona
        const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fecha.getDay()];
        const horarioNegocio = (datosNegocio.horario || {})[diaSem] || { abierto: true, inicio: '09:00', fin: '18:00' };
        if (!horarioNegocio.abierto) {
            slotsContainer.innerHTML = 'No laboramos este día.';
            cargandoHorarios = false;
            clearTimeout(timeoutId);
            return;
        }

        const [hIni, mIni] = horarioNegocio.inicio.split(':').map(Number);
        const [hFin, mFin] = horarioNegocio.fin.split(':').map(Number);
        const inicioMinutos = hIni * 60 + mIni;
        const finMinutos = hFin * 60 + mFin;

        // Rango de tiempo del día seleccionado (local)
        const inicioDia = new Date(fechaStr + 'T00:00:00');
        const finDia = new Date(fechaStr + 'T23:59:59');

        // SOLUCIÓN BUG #1: usamos una consulta con filtro por fecha en Firestore
        // para solo descargar las citas del día, no todas.
        const citasQuery = query(
            collection(db, 'negocios', negocioId, 'citas'),
            where('fechaHora', '>=', inicioDia),
            where('fechaHora', '<=', finDia)
        );
        const citasSnap = await getDocs(citasQuery);

        const ocupados = [];
        citasSnap.forEach(citaDoc => {
            const c = citaDoc.data();
            if (c.estado === 'cancelada') return;
            const fechaCita = c.fechaHora.toDate();
            ocupados.push({
                inicio: fechaCita.getHours() * 60 + fechaCita.getMinutes(),
                duracion: c.duracion || duracion
            });
        });

        // Generar slots cada 30 min
        slotsContainer.innerHTML = '';
        let slotsGenerados = 0;
        for (let min = inicioMinutos; min < finMinutos; min += 30) {
            const slotFin = min + duracion;
            if (slotFin > finMinutos) break;
            const choca = ocupados.some(cita => {
                return (min < cita.inicio + cita.duracion && slotFin > cita.inicio);
            });
            if (!choca) {
                const horas = Math.floor(min / 60);
                const minutos = min % 60;
                const horaStr = `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;
                const slot = document.createElement('div');
                slot.className = 'slot';
                slot.textContent = horaStr;
                slot.addEventListener('click', () => {
                    document.querySelectorAll('.slot').forEach(s => s.classList.remove('seleccionado'));
                    slot.classList.add('seleccionado');
                    horarioSeleccionado = horaStr;
                    document.getElementById('btn-siguiente-paso3').disabled = false;
                });
                slotsContainer.appendChild(slot);
                slotsGenerados++;
            }
        }
        if (slotsGenerados === 0) {
            slotsContainer.innerHTML = 'No hay horarios disponibles para esta fecha.';
        }
    } catch (error) {
        console.error('Error al cargar horarios:', error);
        slotsContainer.innerHTML = `<p style="color: #b91c1c;">Error al cargar horarios: ${error.message}. 
        <button id="retry-horarios" style="color: #4f46e5; text-decoration: underline; background: none; border: none; cursor: pointer;">Reintentar</button></p>`;
        document.getElementById('retry-horarios')?.addEventListener('click', () => {
            cargarHorariosDisponibles(fechaStr);
        });
    } finally {
        cargandoHorarios = false;
        clearTimeout(timeoutId);
    }
}

// ==================== NAVEGACIÓN ====================
document.getElementById('btn-siguiente').addEventListener('click', () => {
    if (!servicioSeleccionado) return;
    mostrarPaso(1);
    if (!miniCalendario) inicializarCalendario();
    else miniCalendario.render();
});

document.getElementById('btn-volver-paso1').addEventListener('click', () => mostrarPaso(0));
document.getElementById('btn-siguiente-paso3').addEventListener('click', () => mostrarPaso(2));
document.getElementById('btn-volver-paso2').addEventListener('click', () => mostrarPaso(1));

// ==================== CONFIRMAR CITA ====================
document.getElementById('form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const email = document.getElementById('cliente-email').value.trim();

    const fechaHora = new Date(`${fechaSeleccionada}T${horarioSeleccionado}:00`);

    const citaData = {
        clienteNombre: nombre,
        clienteTelefono: telefono,
        clienteEmail: email,
        servicioId: servicioSeleccionado.id,
        servicioNombre: servicioSeleccionado.nombre,
        empleadoId: empleadoSeleccionado?.id || null,
        fechaHora,
        color: servicioSeleccionado.color || '#667eea',
        estado: 'confirmada',
        createdAt: new Date()
    };

    try {
        await addDoc(collection(db, 'negocios', negocioId, 'citas'), citaData);
        const resumen = `${servicioSeleccionado.nombre} el ${fechaSeleccionada} a las ${horarioSeleccionado}`;
        document.getElementById('resumen-cita').textContent = resumen;
        mostrarPaso(3);

        const waNumero = datosNegocio.whatsapp || datosNegocio.telefono;
        const mensaje = `Hola, confirmo mi cita: ${resumen}. Gracias.`;
        document.getElementById('btn-whatsapp').onclick = () => {
            window.open(`https://wa.me/${waNumero}?text=${encodeURIComponent(mensaje)}`, '_blank');
        };
    } catch (error) {
        alert('Error al agendar la cita: ' + error.message);
    }
});

// Nueva cita: reiniciar estado
document.getElementById('btn-nueva-cita').addEventListener('click', () => {
    servicioSeleccionado = null;
    empleadoSeleccionado = null;
    fechaSeleccionada = null;
    horarioSeleccionado = null;
    document.querySelectorAll('.seleccionado, .fc-day-today').forEach(el => el.classList.remove('seleccionado', 'fc-day-today'));
    document.getElementById('btn-siguiente').disabled = true;
    document.getElementById('form-cliente').reset();
    if (miniCalendario) {
        miniCalendario.destroy();
        miniCalendario = null;
    }
    mostrarPaso(0);
});

// Inicio
cargarNegocio();
mostrarPaso(0);