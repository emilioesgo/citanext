import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let uid;
let qrCodeInstance = null;
let calendarioCitas = null;
const DIAS_SEMANA = ['lun','mar','mie','jue','vie','sab','dom'];
const NOMBRES_DIAS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

// ---- AUTENTICACIÓN ----
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  cargarPerfil();
  cargarServicios();
  cargarEmpleados();
  inicializarCalendarioCitas();
  cargarEnlace();
  cargarHorarios();
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'auth.html';
});

// ---- PESTAÑAS ----
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    document.getElementById(tabId).classList.add('active');

    // FIX #6: al volver a la pestaña de citas se refresca la disponibilidad en lugar
    // de intentar re-inicializar (el guard if(calendarioCitas) return lo bloquearía)
    if (btn.dataset.tab === 'citas') {
      if (calendarioCitas) {
        actualizarDisponibilidadCalendario();
      } else {
        setTimeout(inicializarCalendarioCitas, 100);
      }
    }
  });
});

// ========== PERFIL ==========
async function cargarPerfil() {
  try {
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);

    if (!snap.exists()) {
      const user = auth.currentUser;
      await setDoc(docRef, {
        nombre: user.displayName || '',
        telefono: '',
        email: user.email,
        whatsapp: '',
        descripcion: '',
        logoURL: '',
        portadaURL: '',
        slug: '',
        createdAt: new Date()
      });
      await cargarPerfil(); // FIX: await para evitar race condition en la llamada recursiva
      return;
    }

    const data = snap.data();
    document.getElementById('perfil-nombre').value = data.nombre || '';
    document.getElementById('perfil-telefono').value = data.telefono || '';
    document.getElementById('perfil-email').value = data.email || '';
    document.getElementById('perfil-whatsapp').value = data.whatsapp || '';
    document.getElementById('perfil-descripcion').value = data.descripcion || '';
    if (data.logoURL) document.getElementById('logo-preview').src = data.logoURL;
    if (data.portadaURL) document.getElementById('portada-preview').src = data.portadaURL;
  } catch (error) {
    console.error('Error al cargar perfil:', error);
    alert('No se pudo cargar el perfil. Revisa tu conexión.');
  }
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  // FIX #4: guard por si auth aún no resolvió
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
  try {
    const docRef = doc(db, 'negocios', uid);
    await setDoc(docRef, {
      nombre: document.getElementById('perfil-nombre').value,
      telefono: document.getElementById('perfil-telefono').value,
      whatsapp: document.getElementById('perfil-whatsapp').value,
      descripcion: document.getElementById('perfil-descripcion').value,
      email: auth.currentUser.email
    }, { merge: true });
    alert('Perfil actualizado');
  } catch (error) {
    console.error('Error al guardar perfil:', error);
    alert('No se pudo guardar el perfil. Intenta de nuevo.');
  }
});

async function subirImagen(file, tipo) {
  try {
    const storageRef = ref(storage, `negocios/${uid}/${tipo}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, { [`${tipo}URL`]: url });
    } else {
      await setDoc(docRef, { [`${tipo}URL`]: url }, { merge: true });
    }
    document.getElementById(`${tipo}-preview`).src = url;
  } catch (error) {
    console.error(`Error al subir imagen (${tipo}):`, error);
    alert('No se pudo subir la imagen. Intenta de nuevo.');
  }
}

document.getElementById('logo-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'logo');
});
document.getElementById('portada-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'portada');
});

// ========== SERVICIOS ==========
async function cargarServicios() {
  try {
    const snap = await getDocs(collection(db, 'negocios', uid, 'servicios'));
    const lista = document.getElementById('lista-servicios');
    lista.innerHTML = '';
    snap.forEach(docSnap => {
      const s = docSnap.data();
      const li = document.createElement('li');
      li.innerHTML = `<span style="color:${s.color}">● ${s.nombre} | ${s.duracion} min | $${s.precio}</span>
        <button class="btn-danger" data-id="${docSnap.id}">Eliminar</button>`;
      li.querySelector('.btn-danger').onclick = () => eliminarServicio(docSnap.id);
      lista.appendChild(li);
    });
  } catch (error) {
    console.error('Error al cargar servicios:', error);
  }
}

async function eliminarServicio(id) {
  try {
    await deleteDoc(doc(db, 'negocios', uid, 'servicios', id));
    cargarServicios();
  } catch (error) {
    console.error('Error al eliminar servicio:', error);
    alert('No se pudo eliminar el servicio.');
  }
}

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!uid) return alert('Sesión no iniciada. Recarga la página.'); // FIX #4
  try {
    const nombre = document.getElementById('servicio-nombre').value;
    const duracion = parseInt(document.getElementById('servicio-duracion').value);
    const precio = parseFloat(document.getElementById('servicio-precio').value);
    const color = document.getElementById('servicio-color').value;
    await addDoc(collection(db, 'negocios', uid, 'servicios'), { nombre, duracion, precio, color });
    e.target.reset();
    cargarServicios();
  } catch (error) {
    console.error('Error al guardar servicio:', error);
    alert('No se pudo guardar el servicio.');
  }
});

// ========== HORARIOS ==========
async function cargarHorarios() {
  try {
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);
    const data = snap.data() || {};
    const horario = data.horario || {};
    const container = document.getElementById('dias-horario');
    if (!container) return;
    container.innerHTML = '';
    DIAS_SEMANA.forEach((dia, idx) => {
      const d = horario[dia] || { abierto: idx < 5, inicio: '09:00', fin: '18:00' };
      const div = document.createElement('div');
      div.className = 'dia-horario';
      div.innerHTML = `
        <label><input type="checkbox" class="chk-abierto" data-dia="${dia}" ${d.abierto ? 'checked' : ''}> ${NOMBRES_DIAS[idx]}</label>
        <div style="margin-top:8px;">
          <input type="time" class="inicio" data-dia="${dia}" value="${d.inicio}" ${d.abierto ? '' : 'disabled'}>
          <span> a </span>
          <input type="time" class="fin" data-dia="${dia}" value="${d.fin}" ${d.abierto ? '' : 'disabled'}>
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
  } catch (error) {
    console.error('Error al cargar horarios:', error);
  }
}

document.getElementById('form-horario')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!uid) return alert('Sesión no iniciada. Recarga la página.'); // FIX #4
  try {
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
  } catch (error) {
    console.error('Error al guardar horarios:', error);
    alert('No se pudo guardar los horarios.');
  }
});

// ========== EMPLEADOS ==========
async function cargarEmpleados() {
  try {
    const snap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
    const lista = document.getElementById('lista-empleados');
    if (!lista) return;
    lista.innerHTML = '';
    snap.forEach(docSnap => {
      const emp = docSnap.data();
      const li = document.createElement('li');
      li.innerHTML = `${emp.nombre} - ${emp.especialidad || 'Sin especialidad'}
        <button class="btn-danger" data-id="${docSnap.id}">Eliminar</button>`;
      li.querySelector('.btn-danger').onclick = () => eliminarEmpleado(docSnap.id);
      lista.appendChild(li);
    });
  } catch (error) {
    console.error('Error al cargar empleados:', error);
  }
}

async function eliminarEmpleado(id) {
  try {
    await deleteDoc(doc(db, 'negocios', uid, 'empleados', id));
    cargarEmpleados();
  } catch (error) {
    console.error('Error al eliminar empleado:', error);
    alert('No se pudo eliminar el empleado.');
  }
}

document.getElementById('form-empleado').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!uid) return alert('Sesión no iniciada. Recarga la página.'); // FIX #4
  try {
    const nombre = document.getElementById('empleado-nombre').value;
    const especialidad = document.getElementById('empleado-especialidad').value;
    await addDoc(collection(db, 'negocios', uid, 'empleados'), { nombre, especialidad });
    e.target.reset();
    cargarEmpleados();
  } catch (error) {
    console.error('Error al guardar empleado:', error);
    alert('No se pudo guardar el empleado.');
  }
});

// ========== CITAS (CALENDARIO DE DISPONIBILIDAD) ==========
function inicializarCalendarioCitas() {
  if (calendarioCitas) return;
  const calendarioEl = document.getElementById('calendario-citas');
  if (!calendarioEl) return;
  calendarioCitas = new FullCalendar.Calendar(calendarioEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    dateClick: (info) => abrirCitasDelDia(info.date),
    dayCellDidMount: (info) => {
      info.el.classList.add('pendiente');
    }
  });
  calendarioCitas.render();
  actualizarDisponibilidadCalendario();
}

async function actualizarDisponibilidadCalendario() {
  if (!calendarioCitas) return;
  try {
    const snapNegocio = await getDoc(doc(db, 'negocios', uid));
    const data = snapNegocio.data() || {};
    const horario = data.horario || {};
    const citasSnapshot = await getDocs(collection(db, 'negocios', uid, 'citas'));

    const citasPorDia = {};
    citasSnapshot.docs.forEach(d => {
      const c = d.data();
      if (c.estado === 'cancelada') return;
      const fecha = c.fechaHora.toDate();
      const key = fecha.toISOString().split('T')[0];
      if (!citasPorDia[key]) citasPorDia[key] = [];
      citasPorDia[key].push(c);
    });

    const diasSemanaJS = ['dom','lun','mar','mie','jue','vie','sab'];
    const calendarApi = calendarioCitas;
    const currentDate = calendarApi.getDate();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);

    document.querySelectorAll('.fc-daygrid-day').forEach(el => {
      el.classList.remove('dia-verde', 'dia-amarillo', 'dia-naranja', 'dia-rojo', 'dia-no-laborable');
    });

    for (let d = new Date(primerDia); d <= ultimoDia; d.setDate(d.getDate() + 1)) {
      const fechaStr = d.toISOString().split('T')[0];
      const diaSem = diasSemanaJS[d.getDay()];
      const config = horario[diaSem] || { abierto: (d.getDay() !== 0), inicio: '09:00', fin: '18:00' };
      const celda = document.querySelector(`.fc-daygrid-day[data-date="${fechaStr}"]`);
      if (!celda) continue;

      if (!config.abierto) {
        celda.classList.add('dia-no-laborable');
        continue;
      }

      const [hIni, mIni] = config.inicio.split(':').map(Number);
      const [hFin, mFin] = config.fin.split(':').map(Number);
      const minutosTotales = (hFin * 60 + mFin) - (hIni * 60 + mIni);
      const maxCitas = Math.floor(minutosTotales / 30);
      const citasHoy = (citasPorDia[fechaStr] || []).length;

      // FIX #3: tres estados diferenciados en lugar de dos ramas iguales en rojo
      if (citasHoy === 0)                        celda.classList.add('dia-verde');
      else if (citasHoy < maxCitas / 2)           celda.classList.add('dia-amarillo');
      else if (citasHoy < maxCitas)               celda.classList.add('dia-naranja'); // casi lleno
      else                                        celda.classList.add('dia-rojo');    // completamente lleno
    }
  } catch (error) {
    console.error('Error al actualizar disponibilidad del calendario:', error);
  }
}

function abrirCitasDelDia(fecha) {
  const modal = document.getElementById('modal-citas-dia');
  const titulo = document.getElementById('fecha-seleccionada');
  const container = document.getElementById('lista-citas-dia');
  if (!modal || !container) return;

  titulo.textContent = `Citas del ${fecha.toLocaleDateString('es-MX', { dateStyle: 'long' })}`;
  container.innerHTML = 'Cargando...';
  modal.classList.remove('hidden');

  // ---- CONFIGURAR CIERRE DEL MODAL ----
  const closeBtn = modal.querySelector('.close');
  const cerrarModal = () => modal.classList.add('hidden');

  if (closeBtn) {
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    modal.querySelector('.close').addEventListener('click', cerrarModal);
  }

  modal.onclick = (e) => {
    if (e.target === modal) cerrarModal();
  };

  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      cerrarModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);

  const mutationObserver = new MutationObserver(() => {
    if (modal.classList.contains('hidden')) {
      document.removeEventListener('keydown', escapeHandler);
      mutationObserver.disconnect();
    }
  });
  mutationObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });

  // ---- CARGAR CITAS DEL DÍA ----
  // FIX #2: construcción de rangos con setHours para respetar zona horaria local
  const inicioDia = new Date(fecha);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(fecha);
  finDia.setHours(23, 59, 59, 999);

  getDocs(query(
    collection(db, 'negocios', uid, 'citas'),
    where('fechaHora', '>=', inicioDia),
    where('fechaHora', '<=', finDia)
  )).then(snap => {
    container.innerHTML = '';
    if (snap.empty) {
      container.innerHTML = '<p style="text-align:center; padding:20px;">No hay citas para este día.</p>';
      return;
    }
    snap.forEach(docSnap => {
      const cita = docSnap.data();
      const hora = cita.fechaHora.toDate().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const div = document.createElement('div');
      div.className = 'item-cita';
      div.innerHTML = `
        <span>${hora} - ${cita.clienteNombre} (${cita.servicioNombre})</span>
        <div>
          <button class="btn-xs btn-cancelar" data-id="${docSnap.id}">❌ Cancelar</button>
          <button class="btn-xs btn-reprogramar" data-id="${docSnap.id}">🔄 Reprogramar</button>
        </div>
      `;
      container.appendChild(div);
    });

    // FIX #1: container.querySelectorAll en lugar de document.querySelectorAll
    // para no afectar botones con el mismo nombre fuera del modal
    container.querySelectorAll('.btn-cancelar').forEach(b => {
      b.onclick = async (e) => {
        if (confirm('¿Cancelar esta cita?')) {
          try {
            await deleteDoc(doc(db, 'negocios', uid, 'citas', e.target.dataset.id));
            abrirCitasDelDia(fecha);
            actualizarDisponibilidadCalendario();
          } catch (error) {
            console.error('Error al cancelar cita:', error);
            alert('No se pudo cancelar la cita.');
          }
        }
      };
    });

    // FIX #1: container.querySelectorAll en lugar de document.querySelectorAll
    container.querySelectorAll('.btn-reprogramar').forEach(b => {
      b.onclick = async (e) => {
        const nuevaFecha = prompt('Introduce nueva fecha y hora (YYYY-MM-DD HH:MM)');
        if (nuevaFecha) {
          try {
            await updateDoc(doc(db, 'negocios', uid, 'citas', e.target.dataset.id), {
              fechaHora: new Date(nuevaFecha)
            });
            abrirCitasDelDia(fecha);
            actualizarDisponibilidadCalendario();
          } catch (error) {
            console.error('Error al reprogramar cita:', error);
            alert('No se pudo reprogramar la cita.');
          }
        }
      };
    });
  }).catch(error => {
    console.error('Error al cargar citas del día:', error);
    container.innerHTML = '<p style="text-align:center; padding:20px; color:red;">Error al cargar las citas.</p>';
  });
}

// ========== ENLACES ==========
async function cargarEnlace() {
  try {
    const docRef = doc(db, 'negocios', uid);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const slug = data.slug || '';
    const slugInput = document.getElementById('slug-input');
    if (slugInput) slugInput.value = slug;
    actualizarEnlaceMostrado(slug);
  } catch (error) {
    console.error('Error al cargar enlace:', error);
  }
}

function actualizarEnlaceMostrado(slug) {
  const base = window.location.origin + '/citanext/reserva.html?negocio=';
  const identificador = slug || uid;
  const enlace = base + identificador;
  const enlaceInput = document.getElementById('enlace-publico');
  if (enlaceInput) enlaceInput.value = enlace;
  generarQR(enlace);
}

function generarQR(texto) {
  const container = document.getElementById('qrcode');
  if (!container) return;
  container.innerHTML = '';
  qrCodeInstance = new QRCode(container, {
    text: texto,
    width: 180,
    height: 180,
    colorDark: "#4f46e5",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

document.getElementById('btn-guardar-slug').addEventListener('click', async () => {
  if (!uid) return alert('Sesión no iniciada. Recarga la página.'); // FIX #4
  const slugInput = document.getElementById('slug-input');
  let slug = slugInput.value.trim().toLowerCase();

  if (slug === '') {
    try {
      await updateDoc(doc(db, 'negocios', uid), { slug: '' });
      actualizarEnlaceMostrado('');
      alert('Slug eliminado. Se usará tu identificador único.');
    } catch (error) {
      console.error('Error al eliminar slug:', error);
      alert('No se pudo eliminar el slug.');
    }
    return;
  }

  if (!/^[a-z0-9\-]{3,30}$/.test(slug)) {
    alert('El slug solo puede contener letras minúsculas, números y guiones. Entre 3 y 30 caracteres.');
    return;
  }

  try {
    const q = query(collection(db, 'negocios'), where('slug', '==', slug));
    const snap = await getDocs(q);
    let duplicado = false;
    snap.forEach(docSnap => {
      if (docSnap.id !== uid) duplicado = true;
    });
    if (duplicado) {
      alert('Este identificador ya está en uso. Elige otro.');
      return;
    }
    await updateDoc(doc(db, 'negocios', uid), { slug });
    actualizarEnlaceMostrado(slug);
    alert('¡Slug guardado! Tu enlace personalizado está listo.');
  } catch (error) {
    console.error('Error al guardar slug:', error);
    alert('Error al verificar o guardar el slug. Revisa la consola.');
  }
});

document.getElementById('copiar-enlace')?.addEventListener('click', () => {
  const enlace = document.getElementById('enlace-publico').value;
  navigator.clipboard.writeText(enlace).then(() => alert('Enlace copiado'));
});

document.getElementById('btn-compartir')?.addEventListener('click', () => {
  const enlace = document.getElementById('enlace-publico').value;
  if (navigator.share) {
    navigator.share({ title: 'Reserva tu cita', text: 'Agenda conmigo', url: enlace }).catch(() => {});
  } else {
    alert('Compartir no soportado en este navegador. Copia el enlace.');
  }
});

document.getElementById('btn-descargar-qr')?.addEventListener('click', () => {
  const canvas = document.querySelector('#qrcode canvas');
  if (!canvas) return alert('QR no generado aún.');
  const link = document.createElement('a');
  link.download = 'citanext-qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ========== OBSERVER PARA PESTAÑA CITAS ==========
// FIX #6: al detectar que la pestaña se activa, se refresca la disponibilidad
// si el calendario ya existe, en lugar de llamar a inicializarCalendarioCitas
// que quedaría bloqueada por el guard interno
const tabObserver = new MutationObserver(() => {
  const citasTab = document.getElementById('tab-citas');
  if (citasTab?.classList.contains('active')) {
    if (calendarioCitas) {
      actualizarDisponibilidadCalendario();
    } else {
      setTimeout(inicializarCalendarioCitas, 100);
    }
  }
});
const tabCitasEl = document.getElementById('tab-citas');
if (tabCitasEl) tabObserver.observe(tabCitasEl, { attributes: true, attributeFilter: ['class'] });
