import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc, query, where, getDocs as getDocsQuery } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let uid;
let qrCodeInstance = null;

// ---- AUTENTICACIÓN ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'auth.html';
    return;
  }
  uid = user.uid;
  cargarPerfil();
  cargarServicios();
  cargarEmpleados();
  cargarCitas();
  cargarEnlace();
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
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// === PERFIL ===
async function cargarPerfil() {
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
    cargarPerfil();
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
}

document.getElementById('form-perfil').addEventListener('submit', async (e) => {
  e.preventDefault();
  const docRef = doc(db, 'negocios', uid);
  await setDoc(docRef, {
    nombre: document.getElementById('perfil-nombre').value,
    telefono: document.getElementById('perfil-telefono').value,
    whatsapp: document.getElementById('perfil-whatsapp').value,
    descripcion: document.getElementById('perfil-descripcion').value,
    email: auth.currentUser.email
  }, { merge: true });
  alert('Perfil actualizado');
});

async function subirImagen(file, tipo) {
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
}

document.getElementById('logo-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'logo');
});
document.getElementById('portada-file').addEventListener('change', (e) => {
  if (e.target.files[0]) subirImagen(e.target.files[0], 'portada');
});

// === SERVICIOS ===
async function cargarServicios() {
  const snap = await getDocs(collection(db, 'negocios', uid, 'servicios'));
  const lista = document.getElementById('lista-servicios');
  lista.innerHTML = '';
  snap.forEach(doc => {
    const s = doc.data();
    const li = document.createElement('li');
    li.innerHTML = `<span style="color:${s.color}">● ${s.nombre} | ${s.duracion} min | $${s.precio}</span>
      <button class="btn-danger" data-id="${doc.id}">Eliminar</button>`;
    li.querySelector('.btn-danger').onclick = () => eliminarServicio(doc.id);
    lista.appendChild(li);
  });
}

async function eliminarServicio(id) {
  await deleteDoc(doc(db, 'negocios', uid, 'servicios', id));
  cargarServicios();
}

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('servicio-nombre').value;
  const duracion = parseInt(document.getElementById('servicio-duracion').value);
  const precio = parseFloat(document.getElementById('servicio-precio').value);
  const color = document.getElementById('servicio-color').value;
  await addDoc(collection(db, 'negocios', uid, 'servicios'), { nombre, duracion, precio, color });
  e.target.reset();
  cargarServicios();
});

// === EMPLEADOS ===
async function cargarEmpleados() {
  const snap = await getDocs(collection(db, 'negocios', uid, 'empleados'));
  const lista = document.getElementById('lista-empleados');
  lista.innerHTML = '';
  snap.forEach(doc => {
    const emp = doc.data();
    const li = document.createElement('li');
    li.innerHTML = `${emp.nombre} - ${emp.especialidad || 'Sin especialidad'}
      <button class="btn-danger" data-id="${doc.id}">Eliminar</button>`;
    li.querySelector('.btn-danger').onclick = () => eliminarEmpleado(doc.id);
    lista.appendChild(li);
  });
}

async function eliminarEmpleado(id) {
  await deleteDoc(doc(db, 'negocios', uid, 'empleados', id));
  cargarEmpleados();
}

document.getElementById('form-empleado').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('empleado-nombre').value;
  const especialidad = document.getElementById('empleado-especialidad').value;
  await addDoc(collection(db, 'negocios', uid, 'empleados'), { nombre, especialidad });
  e.target.reset();
  cargarEmpleados();
});

// === CITAS ===
async function cargarCitas() {
  const snap = await getDocs(collection(db, 'negocios', uid, 'citas'));
  const div = document.getElementById('lista-citas');
  div.innerHTML = '';
  if (snap.empty) return div.innerHTML = 'No tienes citas próximas.';
  snap.forEach(doc => {
    const c = doc.data();
    const fecha = new Date(c.fechaHora.seconds * 1000);
    div.innerHTML += `<p>📌 ${c.clienteNombre} - ${fecha.toLocaleString()}</p>`;
  });
}

// ==================== NUEVA SECCIÓN ENLACES ====================
async function cargarEnlace() {
  const docRef = doc(db, 'negocios', uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const slug = data.slug || '';
  document.getElementById('slug-input').value = slug;
  actualizarEnlaceMostrado(slug);
}

function actualizarEnlaceMostrado(slug) {
  const base = window.location.origin + '/reserva.html?negocio=';
  const identificador = slug || uid;
  const enlace = base + identificador;
  document.getElementById('enlace-publico').value = enlace;
  generarQR(enlace);
}

function generarQR(texto) {
  const container = document.getElementById('qrcode');
  container.innerHTML = '';
  if (qrCodeInstance) qrCodeInstance = null;
  qrCodeInstance = new QRCode(container, {
    text: texto,
    width: 180,
    height: 180,
    colorDark: "#4f46e5",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

// Guardar slug
document.getElementById('btn-guardar-slug').addEventListener('click', async () => {
  const slugInput = document.getElementById('slug-input');
  let slug = slugInput.value.trim().toLowerCase();
  
  if (slug === '') {
    // Si borra el slug, se usará el UID por defecto
    await updateDoc(doc(db, 'negocios', uid), { slug: '' });
    actualizarEnlaceMostrado('');
    alert('Slug eliminado. Se usará tu identificador único.');
    return;
  }

  // Validar formato
  if (!/^[a-z0-9\-]{3,30}$/.test(slug)) {
    alert('El slug solo puede contener letras minúsculas, números y guiones. Entre 3 y 30 caracteres.');
    return;
  }

  // Verificar si el slug ya está en uso por otro negocio
  const q = query(collection(db, 'negocios'), where('slug', '==', slug));
  const snap = await getDocsQuery(q);
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
});

// Copiar enlace
document.getElementById('copiar-enlace').addEventListener('click', () => {
  const enlace = document.getElementById('enlace-publico').value;
  navigator.clipboard.writeText(enlace).then(() => alert('Enlace copiado al portapapeles'));
});

// Compartir (Web Share API)
document.getElementById('btn-compartir').addEventListener('click', () => {
  const enlace = document.getElementById('enlace-publico').value;
  if (navigator.share) {
    navigator.share({
      title: 'Reserva tu cita conmigo',
      text: 'Agenda tu cita fácilmente usando este enlace.',
      url: enlace
    }).catch(() => {});
  } else {
    alert('Tu navegador no soporta compartir. Copia el enlace manualmente.');
  }
});

// Descargar QR
document.getElementById('btn-descargar-qr').addEventListener('click', () => {
  const canvas = document.querySelector('#qrcode canvas');
  if (!canvas) {
    alert('El código QR aún no se ha generado.');
    return;
  }
  const link = document.createElement('a');
  link.download = 'citanext-qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});