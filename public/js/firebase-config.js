import { initializeApp } from "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTLyTlRadubRJRkISfCRxTYOfhj07kH60",
  authDomain: "analizadorproductos-ca48d.firebaseapp.com",
  projectId: "analizadorproductos-ca48d",
  storageBucket: "analizadorproductos-ca48d.firebasestorage.app",
  messagingSenderId: "293973540616",
  appId: "1:293973540616:web:2f659c9e67ad424fb836bd",
  measurementId: "G-16ZYP7PB7X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

export { app, auth, firebaseConfig };
