import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid, calendario;
let citaEditandoId = null; // Guarda el ID si estamos editando

// Elementos del DOM
const modal = document.getElementById('modal-cita');
const formCita = document.getElementById('form-cita');
const modalTitulo = document.getElementById('modal-titulo');
const btnEliminar = document.getElementById('btn-eliminar-cita');

// === AUTENTICACIÓN ===
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  cargarCalendario();
  cargarServiciosEnSelect();
  cargarEmpleadosEnSelect();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'auth.html';
});

// === CERRAR MODAL ===
document.querySelector('.close').addEventListener('click', () => {
  modal.classList.add('hidden');
  resetFormulario();
});

window.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.classList.add('hidden');
    resetFormulario();
  }
});

function resetFormulario() {
  formCita.reset();
  citaEditandoId = null;
  btnEliminar.classList.add('hidden');
  modalTitulo.textContent = 'Nueva cita';
}

// === CARGAR SERVICIOS Y EMPLEADOS EN LOS SELECT ===
async function cargarServiciosEnSelect() {
  const select = document.getElementById('cita-servicio');
  select.innerHTML = '<option value="">Selecciona un servicio</option>';
  const snap = await getDocs(collection(db, 'negocios', uid, 'servicios'));
  snap.forEach(doc => {
    const s = doc.data();
    select.innerHTML += `<option value="${doc.id}">${s.nombre} (${s.duracion} min)</option>`;
  });
}

async function cargarEmpleadosEnSelect() {
  const select = document.getElementById('cita-empleado');
  select.innerHTML = '<option value="">Cualquier empleado</option>';
  const snap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
  snap.forEach(doc => {
    select.innerHTML += `<option value="${doc.id}">${doc.data().nombre}</option>`;
  });
}

// === CARGAR CALENDARIO ===
async function cargarCalendario() {
  const calendarEl = document.getElementById('calendar');
  const citasSnapshot = await getDocs(collection(db, 'negocios', uid, 'citas'));
  const eventos = [];

  citasSnapshot.forEach(citaDoc => {
    const c = citaDoc.data();
    const servicioId = c.servicioId;
    // Obtenemos el color del servicio (puede estar en una consulta aparte o lo almacenamos en la cita)
    // Para simplificar, asumimos que el color se guardó en la cita o lo obtenemos dinámico.
    eventos.push({
      id: citaDoc.id,
      title: `${c.clienteNombre} - ${c.servicioNombre || 'Servicio'}`,
      start: c.fechaHora.toDate(), // Convertir Timestamp a Date
      backgroundColor: c.color || '#667eea',
      borderColor: c.color || '#667eea',
      extendedProps: {
        clienteNombre: c.clienteNombre,
        clienteTelefono: c.clienteTelefono,
        clienteEmail: c.clienteEmail || '',
        servicioId: c.servicioId,
        empleadoId: c.empleadoId || '',
        color: c.color || '#667eea'
      }
    });
  });

  calendario = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },
    locale: 'es',
    buttonText: { today: 'Hoy', month: 'Mes', week: 'Semana', day: 'Día' },
    events: eventos,
    editable: false, // No permitimos arrastre por simplicidad
    selectable: true,
    dateClick: (info) => {
      // Abrir modal para nueva cita con fecha preseleccionada
      document.getElementById('cita-fecha').value = info.dateStr + 'T09:00';
      modal.classList.remove('hidden');
    },
    eventClick: (info) => {
      // Editar cita existente
      abrirEdicionCita(info.event);
    }
  });
  calendario.render();
}

// === ABRIR MODAL PARA EDITAR ===
function abrirEdicionCita(event) {
  const props = event.extendedProps;
  citaEditandoId = event.id;
  modalTitulo.textContent = 'Editar cita';
  document.getElementById('cita-cliente').value = props.clienteNombre || '';
  document.getElementById('cita-telefono').value = props.clienteTelefono || '';
  document.getElementById('cita-email').value = props.clienteEmail || '';
  document.getElementById('cita-servicio').value = props.servicioId || '';
  document.getElementById('cita-empleado').value = props.empleadoId || '';
  // Formatear fecha para input datetime-local
  const fecha = event.start;
  const offset = fecha.getTimezoneOffset();
  const localFecha = new Date(fecha.getTime() - (offset * 60000));
  document.getElementById('cita-fecha').value = localFecha.toISOString().slice(0, 16);

  btnEliminar.classList.remove('hidden');
  modal.classList.remove('hidden');
}

// === GUARDAR CITA (CREAR O EDITAR) ===
formCita.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteNombre = document.getElementById('cita-cliente').value;
  const clienteTelefono = document.getElementById('cita-telefono').value;
  const clienteEmail = document.getElementById('cita-email').value;
  const servicioId = document.getElementById('cita-servicio').value;
  const empleadoId = document.getElementById('cita-empleado').value;
  const fechaInput = document.getElementById('cita-fecha').value;

  // Obtener nombre y color del servicio
  const servicioSnap = await getDoc(doc(db, 'negocios', uid, 'servicios', servicioId));
  const servicioData = servicioSnap.data();
  const servicioNombre = servicioData ? servicioData.nombre : '';
  const color = servicioData ? servicioData.color : '#667eea';

  const citaData = {
    clienteNombre,
    clienteTelefono,
    clienteEmail,
    servicioId,
    servicioNombre,
    empleadoId: empleadoId || null,
    fechaHora: new Date(fechaInput),
    color,
    estado: 'confirmada'
  };

  try {
    if (citaEditandoId) {
      await updateDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId), citaData);
    } else {
      await addDoc(collection(db, 'negocios', uid, 'citas'), citaData);
    }
    modal.classList.add('hidden');
    resetFormulario();
    // Recargar el calendario
    calendario.removeAllEvents();
    cargarCalendario();
  } catch (error) {
    alert('Error al guardar: ' + error.message);
  }
});

// === ELIMINAR CITA ===
btnEliminar.addEventListener('click', async () => {
  if (!citaEditandoId) return;
  if (confirm('¿Eliminar esta cita?')) {
    await deleteDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId));
    modal.classList.add('hidden');
    resetFormulario();
    calendario.removeAllEvents();
    cargarCalendario();
  }
});

// === ENVIAR WHATSAPP (podemos agregar un botón en el modal) ===
// Añadir después del botón eliminar en el HTML o aquí dinámicamente
// Pero no lo incluí en el HTML original, así que lo agregaremos en el dashboard de citas.