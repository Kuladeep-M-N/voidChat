import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_ANON = "VoidAdmin";
const ADMIN_PASS = "VoidAdminPassword123!";
const ADMIN_REAL = "VoidAdmin";
const ADMIN_EMAIL = "voidadmin@voidchat.internal";

async function restoreAdmin() {
  console.log("🚀 Starting Admin Restoration...");
  try {
    console.log(`🔐 Attempting to sign in as ${ADMIN_EMAIL}...`);
    const userCredential = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
    const user = userCredential.user;
    console.log(`✅ Signed in! UID: ${user.uid}`);

    console.log("📝 Recreating Firestore document...");
    await setDoc(doc(db, 'users', user.uid), {
      id: user.uid,
      anonymous_username: ADMIN_ANON,
      real_username: ADMIN_REAL,
      password: ADMIN_PASS,
      joined_at: new Date().toISOString(),
      is_admin: true,
      status: 'active'
    });
    console.log("✨ Admin account successfully restored in Firestore!");
  } catch (err) {
    console.error("❌ Error restoring admin:", err.message);
    if (err.code === 'auth/user-not-found') {
        console.log("💡 The Auth user was also deleted. You'll need to sign up again with these exact credentials.");
    }
  }
}

restoreAdmin();
