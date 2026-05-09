import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, addDoc, updateDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid, calendario;
let citaEditandoId = null;
let horarioSeleccionado = null;      // ← guarda la hora del slot elegido (HH:MM)

// Elementos del DOM (que sí existen desde el principio)
const modal = document.getElementById('modal-cita');
const formCita = document.getElementById('form-cita');
const modalTitulo = document.getElementById('modal-titulo');
const btnEliminar = document.getElementById('btn-eliminar-cita');
const slotsContainer = document.getElementById('slots-cita');
const slotSeleccionadoTexto = document.getElementById('slot-seleccionado-texto');

// ===== CARGAR DATOS DEL NEGOCIO PARA LA BARRA SUPERIOR =====
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

// === AUTENTICACIÓN ===
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
  slotsContainer.innerHTML = '– Primero selecciona una fecha –';
  slotSeleccionadoTexto.style.display = 'none';
  horarioSeleccionado = null;
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
// INICIALIZAR CALENDARIO (paginación automática)
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
      }
    },
    eventClick: (info) => abrirEdicionCita(info.event)
  });

  calendario.render();

  // Recalcular slots cuando cambie el servicio o empleado
  document.getElementById('cita-servicio').addEventListener('change', () => {
    const fechaInput = document.getElementById('cita-fecha-input');
    if (fechaInput && fechaInput.value) cargarSlotsDisponibles(fechaInput.value);
  });
  document.getElementById('cita-empleado').addEventListener('change', () => {
    const fechaInput = document.getElementById('cita-fecha-input');
    if (fechaInput && fechaInput.value) cargarSlotsDisponibles(fechaInput.value);
  });
}

// Carga eventos del rango visible
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

// ======================================================================
// Cargar slots horarios disponibles para un día
// FIX BUG 2: acepta horaPreselecta para preseleccionar sin setTimeout
// ======================================================================
async function cargarSlotsDisponibles(fechaStr, horaPreselecta = null) {
  slotsContainer.innerHTML = '<div class="spinner"></div> Buscando horarios…';
  slotSeleccionadoTexto.style.display = 'none';
  horarioSeleccionado = null;

  const servicioId = document.getElementById('cita-servicio').value;
  if (!servicioId) {
    slotsContainer.innerHTML = 'Selecciona un servicio primero.';
    return;
  }

  // Obtener duración del servicio
  const servicioSnap = await getDoc(doc(db, 'negocios', uid, 'servicios', servicioId));
  const servicioData = servicioSnap.data();
  const duracion = servicioData ? (servicioData.duracion || 30) : 30;

  // Obtener horario del negocio para ese día
  const fecha = new Date(fechaStr + 'T12:00:00');
  const diaSem = ['dom','lun','mar','mie','jue','vie','sab'][fecha.getDay()];
  const negocioSnap = await getDoc(doc(db, 'negocios', uid));
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

  // Obtener citas del día
  const inicioDia = new Date(fechaStr + 'T00:00:00');
  const finDia = new Date(fechaStr + 'T23:59:59');
  const citasQuery = query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', inicioDia),
    where('fechaHora', '<=', finDia)
  );
  const citasSnap = await getDocs(citasQuery);

  const empleadoIdSeleccionado = document.getElementById('cita-empleado').value || null;

  // Construir array de ocupados con empleadoId
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

  // Empleados activos (para el caso "Cualquiera")
  let empleadosActivosIds = [];
  if (!empleadoIdSeleccionado) {
    const empSnap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
    empleadosActivosIds = empSnap.docs
      .filter(d => d.data().disponible !== false)
      .map(d => d.id);
  }

  slotsContainer.innerHTML = '';
  let slotsGenerados = 0;

  // FIX BUG 3: el incremento usa la duración del servicio en lugar de 30 fijo,
  // así los slots no se solapan entre sí.
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

      // FIX BUG 2: preseleccionar el slot de la cita original si coincide,
      // eliminando la necesidad del setTimeout en abrirEdicionCita.
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

// === ABRIR MODAL PARA EDITAR ===
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

  // Obtener la hora original para preseleccionarla
  const horaOriginal = localFecha.toTimeString().slice(0, 5);

  // FIX BUG 2: pasar horaOriginal a cargarSlotsDisponibles para que la preseleccione
  // al terminar de renderizar, sin depender de un setTimeout frágil.
  // horarioSeleccionado se establece dentro de cargarSlotsDisponibles si el slot existe,
  // o aquí como respaldo por si el horario original ya no está disponible.
  horarioSeleccionado = horaOriginal;
  if (fechaInput) await cargarSlotsDisponibles(fechaInput.value, horaOriginal);

  btnEliminar.classList.remove('hidden');
  modal.classList.remove('hidden');
}

// ======================================================================
// VALIDADOR DE COLISIONES
// FIX BUG 1: lógica de empleado ahora es simétrica y consistente con
// cargarSlotsDisponibles. Una cita con empleadoId=null ("cualquier empleado")
// puede chocar con cualquier empleado específico y viceversa.
// Solo se omite la verificación cuando ambas citas tienen empleados
// específicos y distintos entre sí.
// ======================================================================
async function verificarDisponibilidad(fechaInicio, duracion, empleadoId, citaIgnorarId = null) {
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

  // Construir lista de empleadoIds que tienen citas conflictivas en ese rango horario
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
    // Empleado específico: bloqueado si su propio id está ocupado O si hay
    // una cita de "cualquier empleado" (null) en ese horario, ya que esa
    // cita pudo haber consumido este empleado.
    const bloqueado = empleadosOcupados.some(
      empId => empId === nuevoEmpleadoId || empId === null
    );
    return !bloqueado;
  } else {
    // "Cualquier empleado": verificar si hay al menos un empleado activo libre,
    // usando la misma lógica que cargarSlotsDisponibles.
    const empSnap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
    const empleadosActivos = empSnap.docs
      .filter(d => d.data().disponible !== false)
      .map(d => d.id);

    if (empleadosActivos.length === 0) {
      // Sin empleados configurados: libre si no hay ninguna cita conflictiva
      return empleadosOcupados.length === 0;
    }

    // Hay al menos un empleado activo que no aparece en la lista de ocupados
    // (ni él directamente ni via una cita de "cualquier empleado")
    return empleadosActivos.some(empId =>
      !empleadosOcupados.some(
        ocupadoId => ocupadoId === empId || ocupadoId === null
      )
    );
  }
}

// ======================================================================
// GUARDAR CITA (CREAR O EDITAR)
// ======================================================================
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

  const disponible = await verificarDisponibilidad(fechaHora, duracion, empleadoId || null, citaEditandoId);
  if (!disponible) {
    alert('El empleado ya tiene una cita en ese horario. Elige otra hora o empleado.');
    return;
  }

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
      await updateDoc(doc(db, 'negocios', uid, 'citas', citaEditandoId), citaData);
      const evento = calendario.getEventById(citaEditandoId);
      if (evento) {
        evento.setProp('title', `${clienteNombre} - ${servicioNombre}`);
        evento.setStart(citaData.fechaHora);
        evento.setExtendedProp('empleadoId', empleadoId || null);
        evento.setExtendedProp('duracion', duracion);
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
          empleadoId: empleadoId || null,
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

// ======================================================================
// ELIMINAR CITA
// ======================================================================
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
