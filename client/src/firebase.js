import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
} from "firebase/auth";

import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBdKhaW21oOwltMmyi9TPaDH_8YadYiTgE",
  authDomain: "chatbot-d73e2.firebaseapp.com",
  projectId: "chatbot-d73e2",
  storageBucket: "chatbot-d73e2.firebasestorage.app",
  messagingSenderId: "182640593365",
  appId: "1:182640593365:web:ce231a4e59925c597f155c",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider =
  new GoogleAuthProvider();