import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, addDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const identificador = urlParams.get('negocio'); // Puede ser UID o slug

if (!identificador) {
  alert('No se especificó un negocio. Contacta al administrador.');
  window.location.href = 'index.html';
}

let servicioSeleccionado = null;
let empleadoSeleccionado = null;
let fechaSeleccionada = null;
let horarioSeleccionado = null;
let datosNegocio = {};
let negocioId = null; // UID real del negocio

// Elementos DOM
const pasos = document.querySelectorAll('.paso');
let pasoActual = 0;

function mostrarPaso(indice) {
  pasos.forEach(p => p.classList.remove('activo'));
  pasos[indice].classList.add('activo');
  pasoActual = indice;
}

// ========== BUSCAR NEGOCIO (UID o slug) ==========
async function cargarNegocio() {
  // 1. Intentar como UID directo
  let snap = await getDoc(doc(db, 'negocios', identificador));
  if (snap.exists()) {
    negocioId = identificador;
    procesarDatosNegocio(snap.data());
    return;
  }

  // 2. Si no existe, buscar por slug
  const q = query(collection(db, 'negocios'), where('slug', '==', identificador));
  const querySnap = await getDocs(q);
  
  if (!querySnap.empty) {
    negocioId = querySnap.docs[0].id; // el UID real del negocio
    procesarDatosNegocio(querySnap.docs[0].data());
  } else {
    alert('El negocio no existe o el enlace es incorrecto.');
    window.location.href = 'index.html';
  }
}

function procesarDatosNegocio(data) {
  datosNegocio = data;
  document.getElementById('nombre-negocio').textContent = data.nombre || 'Mi Negocio';
  document.getElementById('logo-img').src = data.logoURL || '';
  document.getElementById('portada-img').src = data.portadaURL || '';
  cargarServicios();
  cargarEmpleados();
}

// ========== CARGAR SERVICIOS ==========
async function cargarServicios() {
  const container = document.getElementById('lista-servicios');
  container.innerHTML = '';
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
}

// ========== CARGAR EMPLEADOS ==========
async function cargarEmpleados() {
  const container = document.getElementById('lista-empleados');
  // Mantener la opción "Cualquiera" (se recrea al limpiar)
  container.innerHTML = '';
  const cualquiera = document.createElement('div');
  cualquiera.className = 'empleado-card seleccionable seleccionado';
  cualquiera.dataset.id = '';
  cualquiera.textContent = 'Cualquiera';
  cualquiera.addEventListener('click', () => {
    document.querySelectorAll('.empleado-card').forEach(c => c.classList.remove('seleccionado'));
    cualquiera.classList.add('sele');
    empleadoSeleccionado = null;
  });
  container.appendChild(cualquiera);

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
}

// ========== CALENDARIO (PASO 2) ==========
let miniCalendario;
function initMiniCalendario() {
  const calendarEl = document.getElementById('mini-calendario');
  if (miniCalendario) miniCalendario.destroy();
  miniCalendario = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    buttonText: { today: 'Hoy' },
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    selectable: true,
    dateClick: async (info) => {
      // Desmarcar fecha anterior visualmente (opcional)
      document.querySelectorAll('.fc-day-selected').forEach(el => el.classList.remove('fc-day-selected'));
      info.dayEl.classList.add('fc-day-selected');
      fechaSeleccionada = info.dateStr;
      await cargarHorariosDisponibles(fechaSeleccionada);
      document.getElementById('btn-siguiente-paso3').disabled = true;
    }
  });
  miniCalendario.render();
}

// ========== CARGAR HORARIOS DISPONIBLES ==========
async function cargarHorariosDisponibles(fechaStr) {
  const slotsContainer = document.getElementById('slots-horarios');
  slotsContainer.innerHTML = 'Cargando horarios...';
  horarioSeleccionado = null;
  document.getElementById('btn-siguiente-paso3').disabled = true;

  if (!servicioSeleccionado) return;
  const duracion = servicioSeleccionado.duracion; // en minutos
  const inicioJornada = 9 * 60; // 9:00 en minutos
  const finJornada = 18 * 60; // 18:00

  // Obtener citas del día
  const inicioDia = new Date(fechaStr + 'T00:00:00');
  const finDia = new Date(fechaStr + 'T23:59:59');
  const citasSnap = await getDocs(collection(db, 'negocios', negocioId, 'citas'));
  const ocupados = [];
  citasSnap.forEach(citaDoc => {
    const c = citaDoc.data();
    const fechaCita = c.fechaHora.toDate();
    if (fechaCita >= inicioDia && fechaCita <= finDia) {
      // Intentar obtener duración del servicio de la cita; si no, usar duración del servicio actual
      const duracionCita = c.duracion || duracion;
      ocupados.push({
        inicio: fechaCita.getHours() * 60 + fechaCita.getMinutes(),
        duracion: duracionCita
      });
    }
  });

  // Generar slots cada 30 min
  slotsContainer.innerHTML = '';
  let slotsGenerados = 0;
  for (let min = inicioJornada; min < finJornada; min += 30) {
    const slotFin = min + duracion;
    if (slotFin > finJornada) break;
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
}

// ========== NAVEGACIÓN ENTRE PASOS ==========
document.getElementById('btn-siguiente').addEventListener('click', () => {
  if (!servicioSeleccionado) {
    alert('Selecciona un servicio primero.');
    return;
  }
  mostrarPaso(1);
  if (!miniCalendario) initMiniCalendario();
  else miniCalendario.render();
});

document.getElementById('btn-volver-paso1').addEventListener('click', () => mostrarPaso(0));
document.getElementById('btn-siguiente-paso3').addEventListener('click', () => mostrarPaso(2));
document.getElementById('btn-volver-paso2').addEventListener('click', () => mostrarPaso(1));

// ========== CONFIRMAR CITA ==========
document.getElementById('form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('cliente-nombre').value.trim();
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const email = document.getElementById('cliente-email').value.trim();

  if (!nombre || !telefono) {
    alert('Nombre y teléfono son obligatorios.');
    return;
  }

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

// ========== NUEVA CITA (REINICIAR) ==========
document.getElementById('btn-nueva-cita').addEventListener('click', () => {
  servicioSeleccionado = null;
  empleadoSeleccionado = null;
  fechaSeleccionada = null;
  horarioSeleccionado = null;
  document.querySelectorAll('.seleccionado, .fc-day-selected').forEach(el => el.classList.remove('seleccionado', 'fc-day-selected'));
  document.getElementById('btn-siguiente').disabled = true;
  document.getElementById('form-cliente').reset();
  if (miniCalendario) {
    miniCalendario.destroy();
    miniCalendario = null;
  }
  mostrarPaso(0);
});

// ========== INICIO ==========
cargarNegocio();
mostrarPaso(0);