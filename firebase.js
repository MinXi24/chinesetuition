// firebase.js  —  Firebase initialisation only.
// Migration helpers have been removed since Firestore is now the primary database.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import {
    getFirestore,
    doc,
    setDoc,
    deleteDoc,
    collection,
    getDocs,
    query,
    where,
    limit
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

async function firebaseInit() {
    if (window.__FIREBASE_INIT_DONE) return;
    try {
        if (!window.FIREBASE_CONFIG) {
            console.warn(
                'No FIREBASE_CONFIG found. ' +
                'Copy firebase-config.example.js to firebase-config.js and add your config.'
            );
            return;
        }
        const app = initializeApp(window.FIREBASE_CONFIG);
        const fs = getFirestore(app);

        window.firebaseApp = app;
        window.firestore = fs;
        window.firebaseHelpers = {
            collection,
            doc,
            getDocs,
            query,
            where,
            limit,
            setDoc,
            deleteDoc
        };
        window.__FIREBASE_INIT_DONE = true;
        console.log('Firebase initialised ✅');
    } catch (e) {
        console.error('Firebase init error', e);
    }
}

window.firebaseInit = firebaseInit;
export { firebaseInit };