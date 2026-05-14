import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ---------------------------------------------------------------------------
   VARIABLES GLOBALES
   --------------------------------------------------------------------------- */
let uid;
let qrCodeInstance = null;
let calendarioCitas = null;
let nombreNegocio = 'Mi Negocio';
let totalEmpleadosActivos = 1;
let inicializandoCalendario = false;

const DIAS_SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const NOMBRES_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/* ---------------------------------------------------------------------------
   FUNCIÓN AUXILIAR XSS
   --------------------------------------------------------------------------- */
function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------------------------------------------------------------------
   AUTENTICACIÓN
   --------------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  uid = user.uid;
  await Promise.all([
    cargarPerfil(),
    cargarServicios(),
    cargarEmpleados(),
    inicializarCalendarioCitas(),
    cargarEnlace(),
    cargarHorarios()
  ]);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'auth.html';
});

/* ---------------------------------------------------------------------------
   PESTAÑAS (con protección de Race Condition)
   --------------------------------------------------------------------------- */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab, .tab-content').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    const tabId = `tab-${btn.dataset.tab}`;
    document.getElementById(tabId).classList.add('active');

    if (btn.dataset.tab === 'citas') {
      if (calendarioCitas) {
        requestAnimationFrame(() => {
          calendarioCitas.updateSize();
          actualizarDisponibilidadCalendario();
        });
      } else if (!inicializandoCalendario) {
        inicializarCalendarioCitas();
      }
    }
  });
});

/* ========================================================================
   PERFIL
   ======================================================================== */
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
      await cargarPerfil();
      return;
    }

    const data = snap.data();
    nombreNegocio = data.nombre || 'Mi Negocio';
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
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
  try {
    const nuevoNombre = document.getElementById('perfil-nombre').value;
    const docRef = doc(db, 'negocios', uid);
    await setDoc(docRef, {
      nombre: nuevoNombre,
      telefono: document.getElementById('perfil-telefono').value,
      whatsapp: document.getElementById('perfil-whatsapp').value,
      descripcion: document.getElementById('perfil-descripcion').value,
      email: auth.currentUser.email
    }, { merge: true });
    nombreNegocio = nuevoNombre || 'Mi Negocio';
    alert('Perfil actualizado');
  } catch (error) {
    console.error('Error al guardar perfil:', error);
    alert('No se pudo guardar el perfil. Intenta de nuevo.');
  }
});

/* ========================================================================
   SUBIDA DE IMAGEN CON REDIMENSIÓN
   ======================================================================== */
async function subirImagen(file, tipo) {
  try {
    const maxWidth = tipo === 'logo' ? 400 : 1200;
    const maxHeight = tipo === 'logo' ? 400 : 400;
    const redimensionado = await redimensionarImagen(file, maxWidth, maxHeight);
    const storageRef = ref(storage, `negocios/${uid}/${tipo}`);
    await uploadBytes(storageRef, redimensionado);
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

function redimensionarImagen(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width / maxWidth > height / maxHeight) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          } else {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('No se pudo generar el blob'));
        }, file.type, 0.85);
      };
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('logo-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'logo');
});
document.getElementById('portada-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'portada');
});

/* ========================================================================
   SERVICIOS (TABLA)
   ======================================================================== */
async function cargarServicios() {
  try {
    const snap = await getDocs(collection(db, 'negocios', uid, 'servicios'));
    const tbody = document.querySelector('#tabla-servicios tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    snap.forEach(docSnap => {
      const s = docSnap.data();
      const row = document.createElement('tr');

      const celdaNombre = document.createElement('td');
      const spanColor = document.createElement('span');
      spanColor.style.display = 'inline-block';
      spanColor.style.width = '12px';
      spanColor.style.height = '12px';
      spanColor.style.borderRadius = '50%';
      spanColor.style.background = s.color;
      spanColor.style.marginRight = '8px';
      celdaNombre.appendChild(spanColor);
      celdaNombre.appendChild(document.createTextNode(s.nombre));
      row.appendChild(celdaNombre);

      const celdaDuracion = document.createElement('td');
      celdaDuracion.textContent = s.duracion + ' min';
      row.appendChild(celdaDuracion);

      const celdaPrecio = document.createElement('td');
      celdaPrecio.textContent = '$' + s.precio;
      row.appendChild(celdaPrecio);

      const celdaColor = document.createElement('td');
      celdaColor.style.textAlign = 'center';
      celdaColor.textContent = s.color;
      row.appendChild(celdaColor);

      const celdaAccion = document.createElement('td');
      const btnEliminar = document.createElement('button');
      btnEliminar.className = 'btn-danger';
      btnEliminar.setAttribute('data-id', docSnap.id);
      btnEliminar.textContent = 'Eliminar';
      btnEliminar.onclick = () => eliminarServicio(docSnap.id);
      celdaAccion.appendChild(btnEliminar);
      row.appendChild(celdaAccion);

      tbody.appendChild(row);
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
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
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

/* ========================================================================
   HORARIOS
   ======================================================================== */
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
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
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

/* ========================================================================
   EMPLEADOS
   ======================================================================== */
async function cargarEmpleados() {
  try {
    const snap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
    const lista = document.getElementById('lista-empleados');
    if (!lista) return;
    lista.innerHTML = '';

    let activos = 0;
    snap.forEach(docSnap => {
      const emp = docSnap.data();
      const disponible = emp.disponible !== false;
      if (disponible) activos++;

      const li = document.createElement('li');
      li.dataset.id = docSnap.id;

      const infoDiv = document.createElement('div');
      infoDiv.style.display = 'flex';
      infoDiv.style.alignItems = 'center';
      infoDiv.style.gap = '10px';
      infoDiv.style.flex = '1';

      const spanNombre = document.createElement('span');
      spanNombre.style.fontWeight = '500';
      spanNombre.textContent = emp.nombre;
      infoDiv.appendChild(spanNombre);

      const spanEspecialidad = document.createElement('span');
      spanEspecialidad.style.color = '#64748b';
      spanEspecialidad.style.fontSize = '0.85rem';
      spanEspecialidad.textContent = emp.especialidad || 'Sin especialidad';
      infoDiv.appendChild(spanEspecialidad);
      li.appendChild(infoDiv);

      const accionesDiv = document.createElement('div');
      accionesDiv.style.display = 'flex';
      accionesDiv.style.alignItems = 'center';
      accionesDiv.style.gap = '10px';

      const btnDisponibilidad = document.createElement('button');
      btnDisponibilidad.className = `btn-disponibilidad ${disponible ? 'disponible' : 'no-disponible'}`;
      btnDisponibilidad.setAttribute('data-id', docSnap.id);
      btnDisponibilidad.setAttribute('data-disponible', disponible);
      btnDisponibilidad.title = disponible
        ? 'Disponible – clic para marcar como no disponible'
        : 'No disponible – clic para marcar como disponible';
      btnDisponibilidad.textContent = disponible ? '🟢 Disponible' : '🔴 No disponible';
      btnDisponibilidad.addEventListener('click', () => toggleDisponibilidadEmpleado(docSnap.id, disponible));
      accionesDiv.appendChild(btnDisponibilidad);

      const btnEliminar = document.createElement('button');
      btnEliminar.className = 'btn-danger';
      btnEliminar.setAttribute('data-id', docSnap.id);
      btnEliminar.textContent = 'Eliminar';
      btnEliminar.addEventListener('click', () => eliminarEmpleado(docSnap.id));
      accionesDiv.appendChild(btnEliminar);
      li.appendChild(accionesDiv);

      lista.appendChild(li);
    });

    totalEmpleadosActivos = Math.max(1, activos);
  } catch (error) {
    console.error('Error al cargar empleados:', error);
  }
}

async function toggleDisponibilidadEmpleado(id, actualDisponible) {
  try {
    const nuevoEstado = !actualDisponible;
    await updateDoc(doc(db, 'negocios', uid, 'empleados', id), { disponible: nuevoEstado });
    await cargarEmpleados();
    if (calendarioCitas) actualizarDisponibilidadCalendario();
  } catch (error) {
    console.error('Error al cambiar disponibilidad:', error);
    alert('No se pudo actualizar la disponibilidad.');
  }
}

async function eliminarEmpleado(id) {
  try {
    await deleteDoc(doc(db, 'negocios', uid, 'empleados', id));
    await cargarEmpleados();
    if (calendarioCitas) actualizarDisponibilidadCalendario();
  } catch (error) {
    console.error('Error al eliminar empleado:', error);
    alert('No se pudo eliminar el empleado.');
  }
}

document.getElementById('form-empleado').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
  try {
    const nombre = document.getElementById('empleado-nombre').value;
    const especialidad = document.getElementById('empleado-especialidad').value;
    await addDoc(collection(db, 'negocios', uid, 'empleados'), {
      nombre,
      especialidad,
      disponible: true
    });
    e.target.reset();
    await cargarEmpleados();
    if (calendarioCitas) actualizarDisponibilidadCalendario();
  } catch (error) {
    console.error('Error al guardar empleado:', error);
    alert('No se pudo guardar el empleado.');
  }
});

/* ========================================================================
   CITAS (CALENDARIO) – REFACTOR: color por minutos reales
   ======================================================================== */
function inicializarCalendarioCitas() {
  if (calendarioCitas || inicializandoCalendario) return;
  inicializandoCalendario = true;

  const calendarioEl = document.getElementById('calendario-citas');
  if (!calendarioEl) {
    inicializandoCalendario = false;
    return;
  }

  calendarioCitas = new FullCalendar.Calendar(calendarioEl, {
    initialView: 'dayGridMonth',
    locale: 'es',
    height: 'auto',
    contentHeight: 580,
    headerToolbar: { left: 'prev', center: 'title', right: 'next' },
    dateClick: (info) => abrirCitasDelDia(info.date),
    dayCellDidMount: (info) => info.el.classList.add('pendiente'),
    datesSet: () => {
      if (calendarioCitas) {
        requestAnimationFrame(() => {
          calendarioCitas.updateSize();
          actualizarDisponibilidadCalendario();
        });
      }
    }
  });

  calendarioCitas.render();
  inicializandoCalendario = false;

  requestAnimationFrame(() => {
    calendarioCitas.updateSize();
    actualizarDisponibilidadCalendario();
  });
}

async function actualizarDisponibilidadCalendario() {
  if (!calendarioCitas) return;
  try {
    const calendarApi = calendarioCitas;
    const activeStart = calendarApi.view.activeStart;
    const activeEnd   = calendarApi.view.activeEnd;

    const snapNegocio = await getDoc(doc(db, 'negocios', uid));
    const data = snapNegocio.data() || {};
    const horario = data.horario || {};

    const citasQuery = query(
      collection(db, 'negocios', uid, 'citas'),
      where('fechaHora', '>=', activeStart),
      where('fechaHora', '<', activeEnd)
    );
    const citasSnapshot = await getDocs(citasQuery);

    // REFACTOR: suma de minutos reales de cada cita en lugar de contar citas
    const minutosOcupadosPorDia = {};
    citasSnapshot.docs.forEach(d => {
      const c = d.data();
      if (c.estado === 'cancelada') return;
      const fecha = c.fechaHora.toDate();
      const key = fecha.toISOString().split('T')[0];
      const duracionCita = c.duracion || 30;   // Usamos la duración almacenada
      if (!minutosOcupadosPorDia[key]) minutosOcupadosPorDia[key] = 0;
      minutosOcupadosPorDia[key] += duracionCita;
    });

    const diasSemanaJS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

    document.querySelectorAll('.fc-daygrid-day').forEach(el => {
      el.classList.remove('dia-verde', 'dia-amarillo', 'dia-naranja', 'dia-rojo', 'dia-no-laborable');
    });

    for (let d = new Date(activeStart); d < activeEnd; d.setDate(d.getDate() + 1)) {
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
      const minutosLaboralesDia = (hFin * 60 + mFin) - (hIni * 60 + mIni);
      // REFACTOR: capacidad total = minutos laborales × empleados activos
      const capacidadTotalMinutos = minutosLaboralesDia * totalEmpleadosActivos;
      const minutosOcupados = minutosOcupadosPorDia[fechaStr] || 0;

      // Colores basados en porcentaje de ocupación real
      if (minutosOcupados === 0) {
        celda.classList.add('dia-verde');
      } else if (minutosOcupados < capacidadTotalMinutos * 0.5) {
        celda.classList.add('dia-amarillo');
      } else if (minutosOcupados < capacidadTotalMinutos) {
        celda.classList.add('dia-naranja');
      } else {
        celda.classList.add('dia-rojo');
      }
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

  const closeBtn = modal.querySelector('.close');
  const cerrarModal = () => modal.classList.add('hidden');
  if (closeBtn) {
    closeBtn.replaceWith(closeBtn.cloneNode(true));
    modal.querySelector('.close').addEventListener('click', cerrarModal);
  }
  modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };
  const escapeHandler = (e) => {
    if (e.key === 'Escape') { cerrarModal(); document.removeEventListener('keydown', escapeHandler); }
  };
  document.addEventListener('keydown', escapeHandler);
  const mutationObserver = new MutationObserver(() => {
    if (modal.classList.contains('hidden')) {
      document.removeEventListener('keydown', escapeHandler);
      mutationObserver.disconnect();
    }
  });
  mutationObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });

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

      const spanInfo = document.createElement('span');
      spanInfo.textContent = `${hora} - ${cita.clienteNombre} (${cita.servicioNombre})`;
      div.appendChild(spanInfo);

      const divBotones = document.createElement('div');
      const btnCancelar = document.createElement('button');
      btnCancelar.className = 'btn-xs btn-cancelar';
      btnCancelar.setAttribute('data-id', docSnap.id);
      btnCancelar.textContent = '❌ Cancelar';
      btnCancelar.onclick = async (e) => {
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
      divBotones.appendChild(btnCancelar);

      const btnReprogramar = document.createElement('button');
      btnReprogramar.className = 'btn-xs btn-reprogramar';
      btnReprogramar.setAttribute('data-id', docSnap.id);
      btnReprogramar.textContent = '🔄 Reprogramar';
      btnReprogramar.onclick = async (e) => {
        const nuevaFecha = prompt('Introduce nueva fecha y hora (YYYY-MM-DD HH:MM)');
        if (nuevaFecha) {
          const fechaValida = new Date(nuevaFecha);
          if (isNaN(fechaValida.getTime())) {
            alert('Formato de fecha inválido. Utiliza el formato YYYY-MM-DD HH:MM');
            return;
          }
          try {
            const docRef = doc(db, 'negocios', uid, 'citas', e.target.dataset.id);
            const docSnap = await getDoc(docRef);
            const citaOriginal = docSnap.data();
            // Preservamos la duración original al reprogramar
            await updateDoc(docRef, {
              fechaHora: fechaValida,
              empleadoId: citaOriginal.empleadoId || null,
              duracion: citaOriginal.duracion || 30
            });
            abrirCitasDelDia(fecha);
            actualizarDisponibilidadCalendario();
          } catch (error) {
            console.error('Error al reprogramar cita:', error);
            alert('No se pudo reprogramar la cita.');
          }
        }
      };
      divBotones.appendChild(btnReprogramar);

      div.appendChild(divBotones);
      container.appendChild(div);
    });
  }).catch(error => {
    console.error('Error al cargar citas del día:', error);
    container.innerHTML = '<p style="text-align:center; padding:20px; color:red;">Error al cargar las citas.</p>';
  });
}

/* ========================================================================
   ENLACES (sin cambios)
   ======================================================================== */
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
  } catch (error) { console.error('Error al cargar enlace:', error); }
}

function actualizarEnlaceMostrado(slug) {
  const identificador = slug || uid;
  const enlaceUrl = new URL('reserva.html', window.location.href);
  enlaceUrl.searchParams.set('negocio', identificador);
  const enlace = enlaceUrl.href;
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
  if (!uid) return alert('Sesión no iniciada. Recarga la página.');
  const slugInput = document.getElementById('slug-input');
  let slug = slugInput.value.trim().toLowerCase();
  if (slug === '') {
    await updateDoc(doc(db, 'negocios', uid), { slug: '' });
    actualizarEnlaceMostrado('');
    alert('Slug eliminado. Se usará tu identificador único.');
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
    snap.forEach(docSnap => { if (docSnap.id !== uid) duplicado = true; });
    if (duplicado) { alert('Este identificador ya está en uso. Elige otro.'); return; }
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
  const titulo = `📅 Reserva tu cita en ${nombreNegocio}`;
  const texto = `¡Hola! Te comparto el enlace para agendar tu cita en *${nombreNegocio}* 🎉\n\nEs muy fácil y rápido — elige tu servicio, fecha y hora en segundos:\n👉 ${enlace}\n\n¡Te esperamos! 😊`;
  if (navigator.share) {
    navigator.share({ title: titulo, text: texto, url: enlace }).catch(() => {});
  } else {
    navigator.clipboard.writeText(texto).then(() => alert('Texto copiado al portapapeles. ¡Pégalo en WhatsApp o tus redes! 📋'))
      .catch(() => alert('Compartir no soportado en este navegador. Copia el enlace manualmente.'));
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

/* ---------------------------------------------------------------------------
   OBSERVER
   --------------------------------------------------------------------------- */
const tabObserver = new MutationObserver(() => {
  const citasTab = document.getElementById('tab-citas');
  if (citasTab?.classList.contains('active')) {
    if (calendarioCitas) {
      requestAnimationFrame(() => {
        calendarioCitas.updateSize();
        actualizarDisponibilidadCalendario();
      });
    } else if (!inicializandoCalendario) {
      inicializarCalendarioCitas();
    }
  }
});
const tabCitasEl = document.getElementById('tab-citas');
if (tabCitasEl) tabObserver.observe(tabCitasEl, { attributes: true, attributeFilter: ['class'] });
