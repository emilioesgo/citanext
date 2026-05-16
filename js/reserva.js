import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const identificador = urlParams.get('negocio');

if (!identificador) {
    alert('No se especificó un negocio. Contacta al administrador.');
    window.location.href = 'index.html';
}

let negocioId = null;
let datosNegocio = {};
let servicioSeleccionado = null;
let empleadoSeleccionado = null;
let fechaSeleccionada = null;
let horarioSeleccionado = null;
let miniCalendario = null;
let cargandoHorarios = false;

const pasos = document.querySelectorAll('.paso');
let pasoActual = 0;

function mostrarPaso(indice) {
    pasos.forEach(p => p.classList.remove('activo'));
    pasos[indice].classList.add('activo');
    pasoActual = indice;
}

// ==================== BUSCAR NEGOCIO ====================
async function cargarNegocio() {
    try {
        let snap = await getDoc(doc(db, 'negocios', identificador));
        if (snap.exists()) {
            negocioId = identificador;
            procesarNegocio(snap.data());
            return;
        }
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
        snap.forEach(docSnap => {
            const s = docSnap.data();
            const card = document.createElement('div');
            card.className = 'servicio-card';
            card.dataset.id = docSnap.id;
            card.dataset.duracion = s.duracion;

            const nombre = document.createElement('div');
            nombre.className = 'nombre';
            nombre.textContent = s.nombre || 'Servicio';

            const detalles = document.createElement('div');
            detalles.className = 'detalles';
            detalles.textContent = `${s.duracion || 30} min · $${s.precio || 0}`;

            card.append(nombre, detalles);
            card.addEventListener('click', () => {
                document.querySelectorAll('.servicio-card').forEach(c => c.classList.remove('seleccionado'));
                card.classList.add('seleccionado');
                servicioSeleccionado = { id: docSnap.id, ...s };
                document.getElementById('btn-siguiente').disabled = false;
            });
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error al cargar servicios:', error);
        container.innerHTML = '<p>Error al cargar servicios.</p>';
    }
}

// ==================== HELPERS DE BLOQUEO ====================
function crearIdBloqueo(fechaHora, offsetMinutos, empleadoId) {
    const fecha = new Date(fechaHora.getTime() + offsetMinutos * 60000);
    const pad = (valor) => String(valor).padStart(2, '0');
    const fechaId = [fecha.getFullYear(), pad(fecha.getMonth() + 1), pad(fecha.getDate())].join('');
    const horaId = `${pad(fecha.getHours())}${pad(fecha.getMinutes())}`;
    return `${fechaId}-${horaId}-${empleadoId || 'negocio'}`;
}

function obtenerRefsBloqueo(fechaHora, duracion, empleadoId) {
    const refs = [];
    for (let offset = 0; offset < duracion; offset += 30) {
        refs.push(doc(db, 'negocios', negocioId, 'bloqueosCitas',
            crearIdBloqueo(fechaHora, offset, empleadoId)));
    }
    return refs;
}

async function obtenerEmpleadosCandidatos() {
    if (empleadoSeleccionado?.id) return [empleadoSeleccionado.id];
    const snap = await getDocs(collection(db, 'negocios', negocioId, 'empleados'));
    const empleadosActivos = snap.docs
        .filter(d => d.data().disponible !== false)
        .map(d => d.id);
    return empleadosActivos.length ? empleadosActivos : [null];
}

async function empleadoDisponibleEnCitas(fechaHora, duracion, empleadoId) {
    const inicioNuevo = fechaHora.getTime();
    const finNuevo = inicioNuevo + duracion * 60000;
    const inicioDia = new Date(fechaHora);
    inicioDia.setHours(0, 0, 0, 0);
    const finDia = new Date(fechaHora);
    finDia.setHours(23, 59, 59, 999);

    const snap = await getDocs(query(
        collection(db, 'negocios', negocioId, 'citas'),
        where('fechaHora', '>=', inicioDia),
        where('fechaHora', '<=', finDia)
    ));

    return !snap.docs.some(citaDoc => {
        const cita = citaDoc.data();
        if (cita.estado === 'cancelada') return false;
        const inicioExistente = cita.fechaHora.toDate().getTime();
        const finExistente = inicioExistente + (cita.duracion || 30) * 60000;
        const hayChoque = inicioNuevo < finExistente && finNuevo > inicioExistente;
        if (!hayChoque) return false;
        const empleadoExistente = cita.empleadoId || null;
        if (!empleadoId) return true;
        return empleadoExistente === empleadoId || empleadoExistente === null;
    });
}

async function guardarCitaConBloqueo(citaData) {
    const candidatos = await obtenerEmpleadosCandidatos();
    const duracion = citaData.duracion || 30;

    for (const empleadoId of candidatos) {
        const sigueDisponible = await empleadoDisponibleEnCitas(citaData.fechaHora, duracion, empleadoId);
        if (!sigueDisponible) continue;
        try {
            const citaGuardada = await runTransaction(db, async (transaction) => {
                const bloqueoRefs = obtenerRefsBloqueo(citaData.fechaHora, duracion, empleadoId);
                for (const bloqueoRef of bloqueoRefs) {
                    const bloqueoSnap = await transaction.get(bloqueoRef);
                    if (bloqueoSnap.exists()) {
                        const error = new Error('slot-ocupado');
                        error.code = 'slot-ocupado';
                        throw error;
                    }
                }
                const citaRef = doc(collection(db, 'negocios', negocioId, 'citas'));
                const datosFinales = { ...citaData, empleadoId: empleadoId || null };
                transaction.set(citaRef, datosFinales);
                bloqueoRefs.forEach((bloqueoRef) => {
                    transaction.set(bloqueoRef, {
                        citaId: citaRef.id,
                        empleadoId: empleadoId || null,
                        fechaHora: citaData.fechaHora,
                        duracion,
                        createdAt: new Date()
                    });
                });
                return { id: citaRef.id, ...datosFinales };
            });
            return citaGuardada;
        } catch (error) {
            if (error.code === 'slot-ocupado') continue;
            throw error;
        }
    }
    throw new Error('Ese horario acaba de ocuparse. Elige otro horario disponible.');
}

// ==================== EMPLEADOS ====================
async function cargarEmpleados() {
    const container = document.getElementById('lista-empleados');
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
        snap.forEach(docSnap => {
            const e = docSnap.data();
            if (e.disponible === false) return;
            const card = document.createElement('div');
            card.className = 'empleado-card seleccionable';
            card.dataset.id = docSnap.id;
            card.textContent = e.nombre;
            if (e.especialidad) card.title = e.especialidad;
            card.addEventListener('click', () => {
                document.querySelectorAll('.empleado-card').forEach(c => c.classList.remove('seleccionado'));
                card.classList.add('seleccionado');
                empleadoSeleccionado = { id: docSnap.id, ...e };
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
            const fechaLocal = new Date(info.dateStr + 'T12:00:00');
            const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fechaLocal.getDay()];
            const config = (datosNegocio.horario || {})[diaSem] || { abierto: true };
            if (!config.abierto) {
                info.el.classList.add('dia-no-laborable');
                info.el.style.pointerEvents = 'none';
            }
        },
        dateClick: async (info) => {
            const fechaLocal = new Date(info.dateStr + 'T12:00:00');
            const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fechaLocal.getDay()];
            const config = (datosNegocio.horario || {})[diaSem] || { abierto: true };
            if (!config.abierto) {
                alert('Lo sentimos, no laboramos este día.');
                return;
            }
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
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

    if (cargandoHorarios) return;
    cargandoHorarios = true;
    horarioSeleccionado = null;
    document.getElementById('btn-siguiente-paso3').disabled = true;
    slotsContainer.innerHTML = '<div class="spinner"></div> Buscando horarios...';

    const timeoutId = setTimeout(() => {
        if (cargandoHorarios) {
            slotsContainer.innerHTML = `<p style="color:#b91c1c;">No se pudieron cargar los horarios.
            <button id="retry-horarios" style="color:#4f46e5;text-decoration:underline;background:none;border:none;cursor:pointer;">Reintentar</button></p>`;
            document.getElementById('retry-horarios')?.addEventListener('click', () => cargarHorariosDisponibles(fechaStr));
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

        const duracion = servicioSeleccionado.duracion;
        const fecha = new Date(fechaStr + 'T12:00:00');
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
        const finMinutos   = hFin * 60 + mFin;

        // ✅ FIX #17: anclar al mediodía + setHours para evitar bug de zona horaria
        const baseDate = new Date(fechaStr + 'T12:00:00');
        const inicioDia = new Date(baseDate);
        inicioDia.setHours(0, 0, 0, 0);
        const finDia = new Date(baseDate);
        finDia.setHours(23, 59, 59, 999);

        const citasSnap = await getDocs(query(
            collection(db, 'negocios', negocioId, 'citas'),
            where('fechaHora', '>=', inicioDia),
            where('fechaHora', '<=', finDia)
        ));

        const ocupados = [];
        citasSnap.forEach(citaDoc => {
            const c = citaDoc.data();
            if (c.estado === 'cancelada') return;
            const fechaCita = c.fechaHora.toDate();
            ocupados.push({
                inicio: fechaCita.getHours() * 60 + fechaCita.getMinutes(),
                duracion: c.duracion || duracion,
                empleadoId: c.empleadoId || null
            });
        });

        let empleadosActivosIds = [];
        if (!empleadoSeleccionado) {
            const empSnap = await getDocs(collection(db, 'negocios', negocioId, 'empleados'));
            empleadosActivosIds = empSnap.docs
                .filter(d => d.data().disponible !== false)
                .map(d => d.id);
        }

        slotsContainer.innerHTML = '';
        let slotsGenerados = 0;

        for (let min = inicioMinutos; min < finMinutos; min += 30) {
            const slotFin = min + duracion;
            if (slotFin > finMinutos) break;

            let slotDisponible = false;

            if (empleadoSeleccionado) {
                const choca = ocupados.some(cita => {
                    const esMismoEmpleado = cita.empleadoId === empleadoSeleccionado.id || cita.empleadoId === null;
                    return esMismoEmpleado && (min < cita.inicio + cita.duracion && slotFin > cita.inicio);
                });
                slotDisponible = !choca;
            } else {
                if (empleadosActivosIds.length === 0) {
                    const choca = ocupados.some(cita => (min < cita.inicio + cita.duracion && slotFin > cita.inicio));
                    slotDisponible = !choca;
                } else {
                    for (const empId of empleadosActivosIds) {
                        const ocupadoEsteEmp = ocupados.some(cita => {
                            const esMismoEmpleado = cita.empleadoId === empId || cita.empleadoId === null;
                            return esMismoEmpleado && (min < cita.inicio + cita.duracion && slotFin > cita.inicio);
                        });
                        if (!ocupadoEsteEmp) { slotDisponible = true; break; }
                    }
                }
            }

            if (slotDisponible) {
                const horaStr = `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
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
        slotsContainer.innerHTML = `<p style="color:#b91c1c;">Error al cargar horarios: ${error.message}.
        <button id="retry-horarios" style="color:#4f46e5;text-decoration:underline;background:none;border:none;cursor:pointer;">Reintentar</button></p>`;
        document.getElementById('retry-horarios')?.addEventListener('click', () => cargarHorariosDisponibles(fechaStr));
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
    const nombre   = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    const email    = document.getElementById('cliente-email').value.trim();

    if (!nombre)    { alert('El nombre es obligatorio.'); return; }
    if (!telefono)  { alert('El teléfono es obligatorio.'); return; }
    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        alert('El correo no es válido.'); return;
    }

    const fechaHora = new Date(`${fechaSeleccionada}T${horarioSeleccionado}:00`);
    const citaData = {
        clienteNombre:    nombre,
        clienteTelefono:  telefono,
        clienteEmail:     email,
        servicioId:       servicioSeleccionado.id,
        servicioNombre:   servicioSeleccionado.nombre,
        empleadoId:       empleadoSeleccionado?.id || null,
        duracion:         servicioSeleccionado.duracion,
        fechaHora,
        color:   servicioSeleccionado.color || '#667eea',
        estado:  'confirmada',
        createdAt: new Date()
    };

    try {
        await guardarCitaConBloqueo(citaData);
        const resumen = `${servicioSeleccionado.nombre} el ${fechaSeleccionada} a las ${horarioSeleccionado}`;
        document.getElementById('resumen-cita').textContent = resumen;
        mostrarPaso(3);

        const waNumero = datosNegocio.whatsapp || datosNegocio.telefono;
        const mensaje  = `Hola, confirmo mi cita: ${resumen}. Gracias.`;
        document.getElementById('btn-whatsapp').onclick = () => {
            window.open(`https://wa.me/${waNumero}?text=${encodeURIComponent(mensaje)}`, '_blank');
        };
    } catch (error) {
        alert('Error al agendar la cita: ' + error.message);
    }
});

// Nueva cita: reiniciar estado
document.getElementById('btn-nueva-cita').addEventListener('click', () => {
    servicioSeleccionado  = null;
    empleadoSeleccionado  = null;
    fechaSeleccionada     = null;
    horarioSeleccionado   = null;
    document.querySelectorAll('.seleccionado, .fc-day-today')
        .forEach(el => el.classList.remove('seleccionado', 'fc-day-today'));
    document.getElementById('btn-siguiente').disabled = true;
    document.getElementById('form-cliente').reset();
    if (miniCalendario) { miniCalendario.destroy(); miniCalendario = null; }
    mostrarPaso(0);
});

// Inicio
cargarNegocio();
mostrarPaso(0);
