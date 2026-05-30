// Lightweight Firebase helper for client-side migration
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getFirestore, doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

async function firebaseInit() {
  if (window.__FIREBASE_INIT_DONE) return;
  try {
    if (!window.FIREBASE_CONFIG) {
      console.warn('No FIREBASE_CONFIG found. Copy firebase-config.example.js to firebase-config.js and add your config.');
      return;
    }
    const app = initializeApp(window.FIREBASE_CONFIG);
    const fs = getFirestore(app);
    window.firebaseApp = app;
    window.firestore = fs;
    window.__FIREBASE_INIT_DONE = true;
    console.log('Firebase initialized');
  } catch (e) {
    console.error('Firebase init error', e);
  }
}

async function migrateLocalToFirebase() {
  await firebaseInit();
  if (!window.__FIREBASE_INIT_DONE) {
    alert('Firebase is not configured. Copy firebase-config.example.js to firebase-config.js and add your config.');
    return;
  }

  if (!confirm('Migrate local users, wallets and progress to Firestore? This will upload current browser localStorage data.')) return;

  const fs = window.firestore;
  const users = JSON.parse(localStorage.getItem('users') || '[]');
  const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
  const progress = JSON.parse(localStorage.getItem('progress') || '{}');

  try {
    // users
    for (const u of users) {
      if (!u.id) continue;
      await setDoc(doc(fs, 'users', u.id), u);
    }

    // wallets
    for (const [uid, w] of Object.entries(wallets)) {
      await setDoc(doc(fs, 'wallets', uid), w);
    }

    // progress records
    for (const [uid, records] of Object.entries(progress)) {
      for (const r of records) {
        const rec = Object.assign({}, r, { userId: uid });
        if (!rec.id) rec.id = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
        await setDoc(doc(fs, 'progressRecords', rec.id), rec);
      }
    }

    alert('Migration complete.');
  } catch (e) {
    console.error(e);
    alert('Migration failed: ' + e.message);
  }
}

window.firebaseInit = firebaseInit;
window.migrateLocalToFirebase = migrateLocalToFirebase;
export { firebaseInit, migrateLocalToFirebase };
