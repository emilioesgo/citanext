import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const authMessage = document.getElementById('auth-message');
const showLoginLink = document.getElementById('show-login');
const showRegisterLink = document.getElementById('show-register');

// Alternar formularios
showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  authMessage.classList.add('hidden');
});

showRegisterLink.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  authMessage.classList.add('hidden');
});

function mostrarMensaje(texto, tipo) {
  authMessage.textContent = texto;
  authMessage.className = `auth-message ${tipo}`;
  authMessage.classList.remove('hidden');
}

// REGISTRO
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('reg-name').value.trim();
  const telefono = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (password.length < 6) {
    mostrarMensaje('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await setDoc(doc(db, 'negocios', user.uid), {
      nombre: nombre,
      telefono: telefono,
      email: email,
      whatsapp: telefono,
      createdAt: new Date()
    });

    mostrarMensaje('¡Registro exitoso! Redirigiendo...', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 1500);
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      mostrarMensaje('Este correo ya está registrado.', 'error');
    } else {
      mostrarMensaje('Error: ' + error.message, 'error');
    }
  }
});

// INICIAR SESIÓN
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    mostrarMensaje('Inicio de sesión correcto. Redirigiendo...', 'success');
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 1000);
  } catch (error) {
    mostrarMensaje('Correo o contraseña incorrectos.', 'error');
  }
});

// Si ya está autenticado, redirigir
onAuthStateChanged(auth, (user) => {
  if (user && window.location.pathname.includes('auth.html')) {
    window.location.href = 'dashboard.html';
  }
});