import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, setDoc, collection, addDoc, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

let uid;

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
    // Si no existe el documento, lo creamos con los datos básicos
    const user = auth.currentUser;
    await setDoc(docRef, {
      nombre: user.displayName || '',
      telefono: '',
      email: user.email,
      whatsapp: '',
      descripcion: '',
      logoURL: '',
      portadaURL: '',
      createdAt: new Date()
    });
    // Ahora que existe, volvemos a cargar el perfil
    cargarPerfil();
    return;
  }
  const enlace = `http://127.0.0.1:5500/reserva.html?negocio=${uid}`;
document.getElementById('enlace-publico').value = enlace;

document.getElementById('copiar-enlace').addEventListener('click', () => {
  navigator.clipboard.writeText(enlace);
  alert('Enlace copiado');
});

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
  // Usamos setDoc con merge:true para crear/actualizar
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
  // Actualizamos en el documento usando setDoc merge (o podemos seguir con updateDoc ya que el doc ya existe)
  const docRef = doc(db, 'negocios', uid);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    await updateDoc(docRef, { [`${tipo}URL`]: url });
  } else {
    // Si por alguna razón no existe, lo creamos con la URL
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