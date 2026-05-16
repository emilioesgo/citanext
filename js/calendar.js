import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid, calendario;
let citaEditandoId = null;
let horarioSeleccionado = null;      // guarda la hora del slot elegido (HH:MM)

// Elementos del DOM (que sí existen desde el principio)
const modal = document.getElementById('modal-cita');
const formCita = document.getElementById('form-cita');
const modalTitulo = document.getElementById('modal-titulo');
const btnEliminar = document.getElementById('btn-eliminar-cita');
const slotsContainer = document.getElementById('slots-cita');
const slotSeleccionadoTexto = document.getElementById('slot-seleccionado-texto');

/* ---------------------------------------------------------------------
   CARGAR DATOS DEL NEGOCIO PARA LA BARRA SUPERIOR
   --------------------------------------------------------------------- */
async function cargarDatosNegocio() {
  try {
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const logoImg = document.getElementById('topbar-logo');
      if (logoImg) {
        if (data.logoURL) {
          logoImg.src = data.logoURL;
          logoImg.style.display = 'inline-block';
        } else {
          logoImg.style.display = 'none';
        }
      }
      const nombreEl = document.getElementById('topbar-nombre');
      if (nombreEl) nombreEl.textContent = data.nombre || 'Citanext';
      document.title = (data.nombre || 'Citanext') + ' – Calendario';
    }
  } catch (error) {
    console.error('Error al cargar datos del negocio para la barra:', error);
  }
}

/* ---------------------------------------------------------------------
   AUTENTICACIÓN
   --------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  await cargarDatosNegocio();
  inicializarCalendario();
  cargarServiciosEnSelect();
  cargarEmpleadosEnSelect();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'auth.html';
});

/* ---------------------------------------------------------------------
   CERRAR MODAL
   --------------------------------------------------------------------- */
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
  slotsContainer.innerHTML = '– Primero selecciona una fecha –';
  slotSeleccionadoTexto.style.display = 'none';
  horarioSeleccionado = null;
}

/* ---------------------------------------------------------------------
   CARGAR SERVICIOS Y EMPLEADOS EN LOS SELECT
   --------------------------------------------------------------------- */
async function cargarServiciosEnSelect() {
  const select = document.getElementById('cita-servicio');
  select.innerHTML = '<option value="">Selecciona un servicio</option>';
  const snap = await getDocs(collection(db, 'negocios', uid, 'servicios'));
  snap.forEach(doc => {
    const s = doc.data();
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = `${s.nombre || 'Servicio'} (${s.duracion || 30} min)`;
    select.appendChild(option);
  });
}

async function cargarEmpleadosEnSelect() {
  const select = document.getElementById('cita-empleado');
  select.innerHTML = '<option value="">Cualquier empleado</option>';
  const snap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
  snap.forEach(doc => {
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = doc.data().nombre || 'Empleado';
    select.appendChild(option);
  });
}

/* ---------------------------------------------------------------------
   INICIALIZAR CALENDARIO (PAGINACIÓN AUTOMÁTICA)
   --------------------------------------------------------------------- */
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
      const fechaInput = document.getElementById('cita-fecha-input');
      if (fechaInput) {
        fechaInput.value = info.dateStr;
        cargarSlotsDisponibles(info.dateStr);
        modal.classList.remove('hidden');
      } else {
        console.warn('No se encontró el input de fecha (cita-fecha-input).');
        alert('Error interno: falta el campo de fecha. Contacta con soporte.');
      }
    },
    eventClick: (info) => abrirEdicionCita(info.event)
  });

  calendario.render();

  // Listeners para recalcular slots al cambiar servicio, empleado o fecha
  document.getElementById('cita-servicio').addEventListener('change', () => {
    const fechaInput = document.getElementById('cita-fecha-input');
    if (fechaInput && fechaInput.value) cargarSlotsDisponibles(fechaInput.value);
  });
  document.getElementById('cita-empleado').addEventListener('change', () => {
    const fechaInput = document.getElementById('cita-fecha-input');
    if (fechaInput && fechaInput.value) cargarSlotsDisponibles(fechaInput.value);
  });
  const fechaInput = document.getElementById('cita-fecha-input');
  if (fechaInput) {
    fechaInput.addEventListener('change', () => {
      if (fechaInput.value) cargarSlotsDisponibles(fechaInput.value);
    });
  }
}

/* ---------------------------------------------------------------------
   CARGAR EVENTOS DEL RANGO VISIBLE
   --------------------------------------------------------------------- */
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
        duracion: c.duracion || 30,
        color: c.color || '#667eea'
      }
    });
  });
  return eventos;
}

/* ---------------------------------------------------------------------
   CARGAR SLOTS HORARIOS DISPONIBLES
   --------------------------------------------------------------------- */
async function cargarSlotsDisponibles(fechaStr, horaPreselecta = null) {
  slotsContainer.innerHTML = '<div class="spinner"></div> Buscando horarios…';
  slotSeleccionadoTexto.style.display = 'none';
  horarioSeleccionado = null;

  const servicioId = document.getElementById('cita-servicio').value;
  if (!servicioId) {
    slotsContainer.innerHTML = 'Selecciona un servicio primero.';
    return;
  }

  // ✅ FIX #16: 3 reads independientes en paralelo → ~50% menos latencia
  const fecha = new Date(fechaStr + 'T12:00:00');
  const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fecha.getDay()];
  const inicioDia = new Date(fechaStr + 'T00:00:00');
  const finDia = new Date(fechaStr + 'T23:59:59');
  const citasQuery = query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', inicioDia),
    where('fechaHora', '<=', finDia)
  );

  const [servicioSnap, negocioSnap, citasSnap] = await Promise.all([
    getDoc(doc(db, 'negocios', uid, 'servicios', servicioId)),
    getDoc(doc(db, 'negocios', uid)),
    getDocs(citasQuery)
  ]);

  const servicioData = servicioSnap.data();
  const duracion = servicioData ? (servicioData.duracion || 30) : 30;
  const negocioData = negocioSnap.data() || {};
  const horarioNegocio = (negocioData.horario || {})[diaSem] || { abierto: true, inicio: '09:00', fin: '18:00' };
  if (!horarioNegocio.abierto) {
    slotsContainer.innerHTML = 'No laboramos este día.';
    return;
  }

  const [hIni, mIni] = horarioNegocio.inicio.split(':').map(Number);
  const [hFin, mFin] = horarioNegocio.fin.split(':').map(Number);
  const inicioMinutos = hIni * 60 + mIni;
  const finMinutos = hFin * 60 + mFin;

  const empleadoIdSeleccionado = document.getElementById('cita-empleado').value || null;

  const ocupados = [];
  citasSnap.forEach(doc => {
    const c = doc.data();
    if (c.estado === 'cancelada') return;
    if (doc.id === citaEditandoId) return;
    const inicio = c.fechaHora.toDate();
    ocupados.push({
      inicio: inicio.getHours() * 60 + inicio.getMinutes(),
      duracion: c.duracion || 30,
      empleadoId: c.empleadoId || null
    });
  });

  let empleadosActivosIds = [];
  if (!empleadoIdSeleccionado) {
    const empSnap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
    empleadosActivosIds = empSnap.docs
      .filter(d => d.data().disponible !== false)
      .map(d => d.id);
  }

  slotsContainer.innerHTML = '';
  let slotsGenerados = 0;
  for (let min = inicioMinutos; min < finMinutos; min += duracion) {
    const slotFin = min + duracion;
    if (slotFin > finMinutos) break;

    let disponible = false;
    if (empleadoIdSeleccionado) {
      const choca = ocupados.some(o =>
        (o.empleadoId === empleadoIdSeleccionado || o.empleadoId === null) &&
        (min < o.inicio + o.duracion && slotFin > o.inicio)
      );
      disponible = !choca;
    } else {
      if (empleadosActivosIds.length === 0) {
        const choca = ocupados.some(o => (min < o.inicio + o.duracion && slotFin > o.inicio));
        disponible = !choca;
      } else {
        for (const empId of empleadosActivosIds) {
          const choca = ocupados.some(o =>
            (o.empleadoId === empId || o.empleadoId === null) &&
            (min < o.inicio + o.duracion && slotFin > o.inicio)
          );
          if (!choca) {
            disponible = true;
            break;
          }
        }
      }
    }

    if (disponible) {
      const horas = Math.floor(min / 60);
      const minutos = min % 60;
      const horaStr = `${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}`;

      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'slot';
      slot.textContent = horaStr;

      if (horaPreselecta && horaStr === horaPreselecta) {
        slot.classList.add('seleccionado');
        horarioSeleccionado = horaStr;
        slotSeleccionadoTexto.textContent = `Hora actual: ${horaStr}`;
        slotSeleccionadoTexto.style.display = 'block';
      }

      slot.addEventListener('click', () => {
        document.querySelectorAll('#slots-cita .slot').forEach(s => s.classList.remove('seleccionado'));
        slot.classList.add('seleccionado');
        horarioSeleccionado = horaStr;
        slotSeleccionadoTexto.textContent = `Has elegido las ${horaStr}`;
        slotSeleccionadoTexto.style.display = 'block';
      });
      slotsContainer.appendChild(slot);
      slotsGenerados++;
    }
  }

  if (slotsGenerados === 0) {
    slotsContainer.innerHTML = 'No hay horarios disponibles.';
  }
}

/* ---------------------------------------------------------------------
   ABRIR MODAL PARA EDITAR
   --------------------------------------------------------------------- */
async function abrirEdicionCita(event) {
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
  const fechaInput = document.getElementById('cita-fecha-input');
  if (fechaInput) {
    fechaInput.value = localFecha.toISOString().slice(0, 10);
  }

  const horaOriginal = localFecha.toTimeString().slice(0, 5);
  horarioSeleccionado = horaOriginal;
  if (fechaInput) await cargarSlotsDisponibles(fechaInput.value, horaOriginal);

  btnEliminar.classList.remove('hidden');
  modal.classList.remove('hidden');
}

/* ---------------------------------------------------------------------
   VALIDADOR DE COLISIONES
   --------------------------------------------------------------------- */
async function verificarDisponibilidad(fechaInicio, duracion, empleadoId, citaIgnorarId = null) {
  return (await obtenerEmpleadoDisponible(fechaInicio, duracion, empleadoId, citaIgnorarId)) !== undefined;
}

async function obtenerEmpleadoDisponible(fechaInicio, duracion, empleadoId, citaIgnorarId = null) {
  const inicioNuevo = fechaInicio.getTime();
  const finNuevo = inicioNuevo + duracion * 60000;

  const inicioDia = new Date(fechaInicio);
  inicioDia.setHours(0,0,0,0);
  const finDia = new Date(fechaInicio);
  finDia.setHours(23,59,59,999);

  const citasQuery = query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', inicioDia),
    where('fechaHora', '<=', finDia)
  );
  const snapshot = await getDocs(citasQuery);

  const empleadosOcupados = [];
  for (const citaDoc of snapshot.docs) {
    const cita = citaDoc.data();
    if (citaDoc.id === citaIgnorarId) continue;
    if (cita.estado === 'cancelada') continue;

    const inicioExistente = cita.fechaHora.toDate().getTime();
    const finExistente = inicioExistente + (cita.duracion || 30) * 60000;
    const hayConflictoHorario = inicioNuevo < finExistente && finNuevo > inicioExistente;

    if (hayConflictoHorario) {
      empleadosOcupados.push(cita.empleadoId || null);
    }
  }

  const nuevoEmpleadoId = empleadoId || null;

  if (nuevoEmpleadoId) {
    const bloqueado = empleadosOcupados.some(
      empId => empId === nuevoEmpleadoId || empId === null
    );
    return bloqueado ? undefined : nuevoEmpleadoId;
  }

  const empSnap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
  const empleadosActivos = empSnap.docs
    .filter(d => d.data().disponible !== false)
    .map(d => d.id);

  if (empleadosActivos.length === 0) {
    return empleadosOcupados.length === 0 ? null : undefined;
  }

  return empleadosActivos.find(empId =>
    !empleadosOcupados.some(ocupadoId => ocupadoId === empId || ocupadoId === null)
  );
}

/* ---------------------------------------------------------------------
   GUARDAR CITA (CREAR O EDITAR)
   --------------------------------------------------------------------- */
formCita.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteNombre = document.getElementById('cita-cliente').value;
  const clienteTelefono = document.getElementById('cita-telefono').value;
  const clienteEmail = document.getElementById('cita-email').value;
  const servicioId = document.getElementById('cita-servicio').value;
  const empleadoId = document.getElementById('cita-empleado').value;

  if (!servicioId) {
    alert('Selecciona un servicio.');
    return;
  }
  if (!horarioSeleccionado) {
    alert('Selecciona una hora disponible.');
    return;
  }

  const fechaInput = document.getElementById('cita-fecha-input');
  if (!fechaInput || !fechaInput.value) {
    alert('Selecciona una fecha.');
    return;
  }

  const servicioSnap = await getDoc(doc(db, 'negocios', uid, 'servicios', servicioId));
  const servicioData = servicioSnap.data();
  const servicioNombre = servicioData ? servicioData.nombre : '';
  const color = servicioData ? servicioData.color : '#667eea';
  const duracion = servicioData?.duracion || 30;

  const fechaHora = new Date(fechaInput.value + 'T' + horarioSeleccionado + ':00');

  const empleadoAsignado = await obtenerEmpleadoDisponible(fechaHora, duracion, empleadoId || null, citaEditandoId);
  if (empleadoAsignado === undefined) {
    alert('No hay empleados disponibles en ese horario. Elige otra hora o empleado.');
    return;
  }

  const citaData = {
    clienteNombre,
    clienteTelefono,
    clienteEmail,
    servicioId,
    servicioNombre,
    empleadoId: empleadoAsignado,
    fechaHora,
    duracion,
    color,
    estado: 'confirmada'
  };

  try {
    if (citaEditandoId) {
      await updateDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId), citaData);
      const evento = calendario.getEventById(citaEditandoId);
      if (evento) {
        evento.setProp('title', `${clienteNombre} - ${servicioNombre}`);
        evento.setStart(citaData.fechaHora);
        evento.setExtendedProp('empleadoId', empleadoAsignado);
        evento.setExtendedProp('duracion', duracion);
        // Actualizar color en vivo
        evento.setProp('backgroundColor', color);
        evento.setProp('borderColor', color);
        evento.setExtendedProp('color', color);
      }
    } else {
      const docRef = await addDoc(collection(db, 'negocios', uid, 'citas'), citaData);
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
          empleadoId: empleadoAsignado,
          duracion,
          color
        }
      });
    }
    modal.classList.add('hidden');
    resetFormulario();
  } catch (error) {
    alert('Error al guardar: ' + error.message);
  }
});

/* ---------------------------------------------------------------------
   ELIMINAR CITA
   --------------------------------------------------------------------- */
btnEliminar.addEventListener('click', async () => {
  if (!citaEditandoId) return;
  if (confirm('¿Eliminar esta cita?')) {
    try {
      await deleteDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId));
      const evento = calendario.getEventById(citaEditandoId);
      if (evento) evento.remove();
      modal.classList.add('hidden');
      resetFormulario();
    } catch (error) {
      alert('Error al eliminar: ' + error.message);
    }
  }
});
