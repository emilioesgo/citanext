import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let uid;
let qrCodeInstance = null;
let calendarioCitas = null;
const DIAS_SEMANA = ['lun','mar','mie','jue','vie','sab','dom'];
const NOMBRES_DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  cargarPerfil();
  cargarServicios();
  cargarEmpleados();
  cargarCitas();        // iniciar calendario solo si la pestaña está activa (se cargará al mostrar)
  cargarEnlace();
  cargarHorarios();     // rellena el formulario de horarios
});

// ... (resto de funciones de perfil, servicios, empleados, enlaces, etc., se mantienen igual) ...

// ===== HORARIOS =====
async function cargarHorarios() {
  const docRef = doc(db, 'negocios', uid);
  const snap = await getDoc(docRef);
  const data = snap.data() || {};
  const horario = data.horario || {};
  const container = document.getElementById('dias-horario');
  container.innerHTML = '';
  DIAS_SEMANA.forEach((dia, idx) => {
    const d = horario[dia] || { abierto: idx<5, inicio: '09:00', fin: '18:00' };
    const div = document.createElement('div');
    div.className = 'dia-horario';
    div.innerHTML = `
      <label><input type="checkbox" class="chk-abierto" data-dia="${dia}" ${d.abierto?'checked':''}> ${NOMBRES_DIAS[idx]}</label>
      <div style="margin-top:8px;">
        <input type="time" class="inicio" data-dia="${dia}" value="${d.inicio}" ${d.abierto?'':'disabled'}>
        <span> a </span>
        <input type="time" class="fin" data-dia="${dia}" value="${d.fin}" ${d.abierto?'':'disabled'}>
      </div>
    `;
    container.appendChild(div);
  });

  document.querySelectorAll('.chk-abierto').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const dia = e.target.dataset.dia;
      const inicio = document.querySelector(`.inicio[data-dia="${dia}"]`);
      const fin = document.querySelector(`.fin[data-dia="${dia}"]`);
      inicio.disabled = !e.target.checked;
      fin.disabled = !e.target.checked;
    });
  });
}

document.getElementById('form-horario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const horario = {};
  DIAS_SEMANA.forEach(dia => {
    const abierto = document.querySelector(`.chk-abierto[data-dia="${dia}"]`).checked;
    const inicio = document.querySelector(`.inicio[data-dia="${dia}"]`).value;
    const fin = document.querySelector(`.fin[data-dia="${dia}"]`).value;
    horario[dia] = { abierto, inicio, fin };
  });
  await updateDoc(doc(db, 'negocios', uid), { horario });
  alert('Horarios guardados');
  if (calendarioCitas) actualizarDisponibilidadCalendario();
});

// ===== CALENDARIO DE CITAS (DISPONIBILIDAD) =====
function inicializarCalendarioCitas() {
  const calendarioEl = document.getElementById('calendario-citas');
  if (calendarioCitas) return;
  calendarioCitas = new FullCalendar.Calendar(calendarioEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    dayCellDidMount: (info) => {
      // Pintar según disponibilidad (se actualizará en actualizarDisponibilidad)
      info.el.classList.add('pendiente');
    },
    dateClick: (info) => {
      abrirCitasDelDia(info.date);
    }
  });
  calendarioCitas.render();
  actualizarDisponibilidadCalendario();
}

async function actualizarDisponibilidadCalendario() {
  if (!calendarioCitas) return;
  // Obtener horarios y citas
  const snapNegocio = await getDoc(doc(db, 'negocios', uid));
  const data = snapNegocio.data();
  const horario = data.horario || {};
  const citasSnapshot = await getDocs(collection(db, 'negocios', uid, 'citas'));

  // Construir mapa de citas por fecha (YYYY-MM-DD)
  const citasPorDia = {};
  citasSnapshot.docs.forEach(d => {
    const c = d.data();
    const fecha = new Date(c.fechaHora.toDate());
    const key = fecha.toISOString().split('T')[0];
    if (!citasPorDia[key]) citasPorDia[key] = [];
    citasPorDia[key].push(c);
  });

  // Recorrer todos los días del mes actual y pintarlos
  const diasSemana = ['dom','lun','mar','mie','jue','vie','sab']; // JS getDay() 0=dom
  const calendarApi = calendarioCitas;
  const currentDate = calendarApi.getDate();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const primerDia = new Date(year, month, 1);
  const ultimoDia = new Date(year, month+1, 0);

  // Eliminar clases anteriores
  document.querySelectorAll('.fc-daygrid-day').forEach(el => {
    el.classList.remove('dia-verde','dia-amarillo','dia-rojo','dia-no-laborable');
  });

  for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate()+1)) {
    const fechaStr = d.toISOString().split('T')[0];
    const diaSem = diasSemana[d.getDay()];
    const config = horario[diaSem] || { abierto: (d.getDay() !== 0), inicio: '09:00', fin: '18:00' };
    const celda = document.querySelector(`.fc-daygrid-day[data-date="${fechaStr}"]`);
    if (!celda) continue;

    if (!config.abierto) {
      celda.classList.add('dia-no-laborable');
      continue;
    }

    const [hIni, mIni] = config.inicio.split(':').map(Number);
    const [hFin, mFin] = config.fin.split(':').map(Number);
    const minutosTotales = (hFin*60+mFin) - (hIni*60+mIni);
    const maxCitas = Math.floor(minutosTotales / 30); // slots de 30 min
    const citasHoy = (citasPorDia[fechaStr] || []).filter(c => c.estado !== 'cancelada').length;

    if (citasHoy === 0) celda.classList.add('dia-verde');
    else if (citasHoy < maxCitas/2) celda.classList.add('dia-amarillo');
    else if (citasHoy < maxCitas) celda.classList.add('dia-rojo');
    else celda.classList.add('dia-rojo'); // lleno
  }
}

function abrirCitasDelDia(fecha) {
  const fechaStr = fecha.toISOString().split('T')[0];
  const modal = document.getElementById('modal-citas-dia');
  document.getElementById('fecha-seleccionada').textContent = `Citas del ${fecha.toLocaleDateString('es-MX', {dateStyle:'long'})}`;
  const container = document.getElementById('lista-citas-dia');
  container.innerHTML = 'Cargando...';
  modal.classList.remove('hidden');

  getDocs(query(collection(db, 'negocios', uid, 'citas'), 
    where('fechaHora', '>=', new Date(fechaStr+'T00:00:00')),
    where('fechaHora', '<=', new Date(fechaStr+'T23:59:59'))
  )).then(snap => {
    container.innerHTML = '';
    if (snap.empty) {
      container.innerHTML = '<p>No hay citas para este día.</p>';
      return;
    }
    snap.forEach(doc => {
      const cita = doc.data();
      const hora = cita.fechaHora.toDate().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'});
      const div = document.createElement('div');
      div.className = 'item-cita';
      div.innerHTML = `
        <span>${hora} - ${cita.clienteNombre} (${cita.servicioNombre})</span>
        <div>
          <button class="btn-xs btn-cancelar" data-id="${doc.id}">❌ Cancelar</button>
          <button class="btn-xs btn-reprogramar" data-id="${doc.id}">🔄 Reprogramar</button>
        </div>
      `;
      container.appendChild(div);
    });

    document.querySelectorAll('.btn-cancelar').forEach(b => {
      b.onclick = async (e) => {
        if (confirm('¿Cancelar esta cita?')) {
          await deleteDoc(doc(db, 'negocios', uid, 'citas', e.target.dataset.id));
          abrirCitasDelDia(fecha); // refrescar modal
          actualizarDisponibilidadCalendario();
        }
      };
    });

    document.querySelectorAll('.btn-reprogramar').forEach(b => {
      b.onclick = (e) => {
        const nuevaFecha = prompt('Introduce nueva fecha y hora (YYYY-MM-DD HH:MM)');
        if (nuevaFecha) {
          updateDoc(doc(db, 'negocios', uid, 'citas', e.target.dataset.id), {
            fechaHora: new Date(nuevaFecha)
          }).then(() => {
            abrirCitasDelDia(fecha);
            actualizarDisponibilidadCalendario();
          });
        }
      };
    });
  });
}

// Cerrar modal
document.querySelector('#modal-citas-dia .close').onclick = () => {
  document.getElementById('modal-citas-dia').classList.add('hidden');
};

// Observar cuando la pestaña "citas" se muestre para inicializar el calendario
const observer = new MutationObserver(() => {
  const citasTab = document.getElementById('tab-citas');
  if (citasTab.classList.contains('active')) {
    inicializarCalendarioCitas();
  }
});
observer.observe(document.getElementById('tab-citas'), { attributes: true, attributeFilter: ['class'] });

// Ajustar también en clic de pestañas
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'citas') setTimeout(inicializarCalendarioCitas, 100);
  });
});