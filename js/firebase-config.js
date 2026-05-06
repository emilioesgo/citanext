import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 👇 Pega aquí el bloque de configuración de tu proyecto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCopuxPLaenM7IRw2paH_sxjQVpNaExNWU",
  authDomain: "citanext-1019e.firebaseapp.com",
  projectId: "citanext-1019e",
  storageBucket: "citanext-1019e.firebasestorage.app",
  messagingSenderId: "241878430993",
  appId: "1:241878430993:web:4b68948f3824b430b848b0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);   // ← ¡Esta línea es la clave!