import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid, calendario;
let citaEditandoId = null; // Guarda el ID si estamos editando

// Elementos del DOM
const modal = document.getElementById('modal-cita');
const formCita = document.getElementById('form-cita');
const modalTitulo = document.getElementById('modal-titulo');
const btnEliminar = document.getElementById('btn-eliminar-cita');

// ===== CARGAR DATOS DEL NEGOCIO PARA LA BARRA SUPERIOR =====
async function cargarDatosNegocio() {
  try {
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      // Logo
      const logoImg = document.getElementById('topbar-logo');
      if (logoImg) {
        if (data.logoURL) {
          logoImg.src = data.logoURL;
          logoImg.style.display = 'inline-block';
        } else {
          logoImg.style.display = 'none';
        }
      }
      // Nombre
      const nombreEl = document.getElementById('topbar-nombre');
      if (nombreEl) {
        nombreEl.textContent = data.nombre || 'Citanext';
      }
      // Título de la página
      document.title = (data.nombre || 'Citanext') + ' – Calendario';
    }
  } catch (error) {
    console.error('Error al cargar datos del negocio para la barra:', error);
  }
}

// === AUTENTICACIÓN ===
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  await cargarDatosNegocio(); // ← Actualiza logo y nombre en la barra superior
  inicializarCalendario();    // REFACTOR: solo se inicializa una vez, sin recargas masivas
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

// ======================================================================
// INICIALIZAR CALENDARIO (REFACTOR: paginación automática con events como función)
// ======================================================================
function inicializarCalendario() {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;

  const esMobil = window.innerWidth < 768;

  calendario = new FullCalendar.Calendar(calendarEl, {
    initialView: esMobil ? 'listWeek' : 'dayGridMonth',
    headerToolbar: esMobil
      ? { left: 'prev,next', center: 'title', right: 'listWeek,dayGridMonth' }
      : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
    locale: 'es',
    buttonText: { today: 'Hoy', month: 'Mes', week: 'Lista', day: 'Día', list: 'Lista' },
    noEventsText: 'No hay citas esta semana',
    editable: false,
    selectable: true,
    // REFACTOR: 'events' como función asíncrona → paginación real
    events: async (fetchInfo, successCallback, failureCallback) => {
      try {
        const eventos = await cargarEventosEnRango(fetchInfo.start, fetchInfo.end);
        successCallback(eventos);
      } catch (error) {
        console.error('Error al cargar eventos del calendario:', error);
        failureCallback(error);
      }
    },
    dateClick: (info) => {
      document.getElementById('cita-fecha').value = info.dateStr + 'T09:00';
      modal.classList.remove('hidden');
    },
    eventClick: (info) => {
      abrirEdicionCita(info.event);
    }
  });

  calendario.render();
}

// REFACTOR: carga únicamente las citas del rango visible (paginación real)
async function cargarEventosEnRango(start, end) {
  const citasQuery = query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', start),
    where('fechaHora', '<=', end)
  );
  const citasSnapshot = await getDocs(citasQuery);
  const eventos = [];
  citasSnapshot.forEach(citaDoc => {
    const c = citaDoc.data();
    eventos.push({
      id: citaDoc.id,
      title: `${c.clienteNombre} - ${c.servicioNombre || 'Servicio'}`,
      start: c.fechaHora.toDate(),
      backgroundColor: c.color || '#667eea',
      borderColor: c.color || '#667eea',
      extendedProps: {
        clienteNombre: c.clienteNombre,
        clienteTelefono: c.clienteTelefono,
        clienteEmail: c.clienteEmail || '',
        servicioId: c.servicioId,
        empleadoId: c.empleadoId || '',
        duracion: c.duracion || 30,          // REFACTOR: duración real disponible
        color: c.color || '#667eea'
      }
    });
  });
  return eventos;
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
  
  const fecha = event.start;
  const offset = fecha.getTimezoneOffset();
  const localFecha = new Date(fecha.getTime() - (offset * 60000));
  document.getElementById('cita-fecha').value = localFecha.toISOString().slice(0, 16);

  btnEliminar.classList.remove('hidden');
  modal.classList.remove('hidden');
}

// ======================================================================
// NUEVO: Función validadora de disponibilidad
// Devuelve true si el horario está libre, false si hay colisión.
// ======================================================================
async function verificarDisponibilidad(fechaInicio, duracion, empleadoId, citaIgnorarId = null) {
  // Calculamos el fin de la nueva cita
  const inicioNuevo = fechaInicio.getTime();
  const finNuevo = new Date(inicioNuevo + duracion * 60000);

  // Rango del día de la nueva cita
  const inicioDia = new Date(fechaInicio);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(fechaInicio);
  finDia.setHours(23, 59, 59, 999);

  // Consultamos solo las citas de ese día (eficiencia)
  const citasQuery = query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', inicioDia),
    where('fechaHora', '<=', finDia)
  );
  const snapshot = await getDocs(citasQuery);

  for (const citaDoc of snapshot.docs) {
    const cita = citaDoc.data();

    // Ignoramos la cita que se está editando
    if (citaDoc.id === citaIgnorarId) continue;

    // Solo nos importan las citas del mismo empleado (o sin empleado si la nueva va sin empleado)
    const citaEmpleadoId = cita.empleadoId || null;
    const nuevoEmpleadoId = empleadoId || null;
    if (citaEmpleadoId !== nuevoEmpleadoId) continue;

    // Calculamos el fin de la cita existente
    const inicioExistente = cita.fechaHora.toDate().getTime();
    const duracionExistente = (cita.duracion || 30) * 60000;
    const finExistente = new Date(inicioExistente + duracionExistente);

    // Fórmula de colisión: InicioNuevo < FinExistente && FinNuevo > InicioExistente
    if (inicioNuevo < finExistente.getTime() && finNuevo.getTime() > inicioExistente) {
      return false; // Hay choque
    }
  }

  return true; // Horario libre
}

// ======================================================================
// GUARDAR CITA (CREAR O EDITAR) – REFACTOR: duración guardada + API local
// ======================================================================
formCita.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteNombre = document.getElementById('cita-cliente').value;
  const clienteTelefono = document.getElementById('cita-telefono').value;
  const clienteEmail = document.getElementById('cita-email').value;
  const servicioId = document.getElementById('cita-servicio').value;
  const empleadoId = document.getElementById('cita-empleado').value;
  const fechaInput = document.getElementById('cita-fecha').value;

  if (!servicioId) {
    alert('Selecciona un servicio.');
    return;
  }

  const servicioSnap = await getDoc(doc(db, 'negocios', uid, 'servicios', servicioId));
  const servicioData = servicioSnap.data();
  const servicioNombre = servicioData ? servicioData.nombre : '';
  const color = servicioData ? servicioData.color : '#667eea';
  const duracion = servicioData?.duracion || 30;   // REFACTOR: extraemos duración real

  const fechaHora = new Date(fechaInput);

  // ----- NUEVO: Validación de disponibilidad antes de guardar -----
  const disponible = await verificarDisponibilidad(
    fechaHora,
    duracion,
    empleadoId || null,
    citaEditandoId  // si estamos editando, ignoramos esta misma cita
  );

  if (!disponible) {
    alert('El empleado ya tiene una cita en ese horario. Elige otra hora o empleado.');
    return;
  }
  // ----------------------------------------------------------------

  const citaData = {
    clienteNombre,
    clienteTelefono,
    clienteEmail,
    servicioId,
    servicioNombre,
    empleadoId: empleadoId || null,
    fechaHora,
    duracion,
    color,
    estado: 'confirmada'
  };

  try {
    if (citaEditandoId) {
      // Editar cita existente
      await updateDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId), citaData);
      // REFACTOR: actualizar evento en el calendario sin recargar todo
      const evento = calendario.getEventById(citaEditandoId);
      if (evento) {
        evento.setProp('title', `${clienteNombre} - ${servicioNombre}`);
        evento.setStart(citaData.fechaHora);
        evento.setExtendedProp('clienteNombre', clienteNombre);
        evento.setExtendedProp('servicioId', servicioId);
        evento.setExtendedProp('empleadoId', empleadoId || null);
        evento.setExtendedProp('duracion', duracion);
      }
    } else {
      // Nueva cita
      const docRef = await addDoc(collection(db, 'negocios', uid, 'citas'), citaData);
      // REFACTOR: agregar evento directamente al calendario
      calendario.addEvent({
        id: docRef.id,
        title: `${clienteNombre} - ${servicioNombre}`,
        start: citaData.fechaHora,
        backgroundColor: color,
        borderColor: color,
        extendedProps: {
          clienteNombre,
          clienteTelefono,
          clienteEmail,
          servicioId,
          empleadoId: empleadoId || null,
          duracion,
          color
        }
      });
    }
    modal.classList.add('hidden');
    resetFormulario();
    // NOTA: ya no se llama a removeAllEvents() ni a cargarCalendario()
  } catch (error) {
    alert('Error al guardar: ' + error.message);
  }
});

// ======================================================================
// ELIMINAR CITA – REFACTOR: eliminación local sin recargar todo el calendario
// ======================================================================
btnEliminar.addEventListener('click', async () => {
  if (!citaEditandoId) return;
  if (confirm('¿Eliminar esta cita?')) {
    try {
      await deleteDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId));
      // REFACTOR: eliminar evento del calendario directamente
      const evento = calendario.getEventById(citaEditandoId);
      if (evento) evento.remove();
      modal.classList.add('hidden');
      resetFormulario();
      // NOTA: ya no se llama a removeAllEvents() ni a cargarCalendario()
    } catch (error) {
      alert('Error al eliminar: ' + error.message);
    }
  }
});