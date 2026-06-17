/**
 * auth.js  —  Firebase-first edition
 *
 * Architecture:
 *   • Firestore is the single source of truth for all users and progress records.
 *   • localStorage stores ONLY the currently logged-in user object (session cache).
 *   • pushAll() / pullAll() / wallet system are removed entirely.
 *   • Every read of users or progress goes directly to Firestore.
 *   • Every write (create / update / delete / record) goes directly to Firestore.
 *
 * Collections used in Firestore:
 *   users             – one doc per user, keyed by user.id
 *   progressRecords   – one doc per practice event, keyed by a unique id
 *
 * Globals exposed:
 *   window.Auth        – login, logout, signup, updateStudent, deleteStudent, getStudents
 *   window.Progress    – recordPracticeAttempt, recordPracticeCompletion,
 *                        getStudentProgress, getStudentPracticeHistory,
 *                        getStudentStats, getAllStudentActivities,
 *                        getListeningCountFromFirebase
 *   window.CloudStore  – bootstrap (initialises Firebase then seeds teacher if needed)
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────

    function uid() {
        return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    function nowISO() {
        return new Date().toISOString();
    }

    /** Wait until window.__FIREBASE_INIT_DONE is true, or reject after timeout. */
    function waitForFirebase(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            console.log('⏳ WAITING FOR FIREBASE...', { firebaseReady: window.__FIREBASE_INIT_DONE });
            if (window.__FIREBASE_INIT_DONE) { 
                console.log('✅ FIREBASE ALREADY READY');
                resolve(); 
                return; 
            }
            const start = Date.now();
            const iv = setInterval(() => {
                if (window.__FIREBASE_INIT_DONE) { 
                    const elapsed = Date.now() - start;
                    console.log('✅ FIREBASE INITIALIZED after', elapsed, 'ms');
                    clearInterval(iv); 
                    resolve(); 
                    return; 
                }
                if (Date.now() - start > timeoutMs) {
                    clearInterval(iv);
                    console.error('❌ FIREBASE INIT TIMEOUT after', timeoutMs, 'ms');
                    reject(new Error('Firebase did not initialise within ' + timeoutMs + 'ms'));
                }
            }, 80);
        });
    }

    function db() { return window.firestore; }

    // Shorthand helpers that mirror the firebaseHelpers object
    function fsCol(name)          { return window.firebaseHelpers.collection(db(), name); }
    function fsDoc(col, id)       { return window.firebaseHelpers.doc(db(), col, id); }
    async function fsGetDocs(ref) { return window.firebaseHelpers.getDocs(ref); }
    async function fsSetDoc(ref, data, opts) {
        return window.firebaseHelpers.setDoc(ref, data, opts || {});
    }
    async function fsDeleteDoc(ref) { return window.firebaseHelpers.deleteDoc(ref); }
    function fsQuery(col, ...constraints) {
        return window.firebaseHelpers.query(col, ...constraints);
    }
    function fsWhere(field, op, val) {
        return window.firebaseHelpers.where(field, op, val);
    }

    // ─────────────────────────────────────────────
    // Debug utilities
    // ─────────────────────────────────────────────

    const Debug = {
        /**
         * Lists all users in Firestore for debugging
         * Call from browser console: window.Debug.listAllUsers()
         */
        async listAllUsers() {
            try {
                console.log('📋 FETCHING ALL USERS FROM FIRESTORE...');
                await waitForFirebase();
                const snap = await fsGetDocs(fsCol('users'));
                const users = snap.docs.map(d => ({
                    id: d.id,
                    ...d.data()
                }));
                console.log('📊 USERS IN FIRESTORE:', users);
                console.table(users.map(u => ({
                    username: u.username,
                    password: u.password,
                    name: u.name,
                    role: u.role,
                    level: u.level
                })));
                return users;
            } catch (err) {
                console.error('❌ Error listing users:', err);
            }
        },

        /**
         * Tests login with given credentials
         * Call from browser console: window.Debug.testLogin('teacher', 'admin123')
         */
        async testLogin(username, password) {
            console.log('🧪 TESTING LOGIN:', { username, password });
            const result = await Auth.loginAsync(username, password);
            console.log('🧪 LOGIN TEST RESULT:', result);
            return result;
        },

        /**
         * Checks Firebase initialization status
         */
        checkFirebase() {
            console.log('🔥 FIREBASE STATUS:', {
                initialized: window.__FIREBASE_INIT_DONE,
                hasApp: !!window.firebaseApp,
                hasFirestore: !!window.firestore,
                hasHelpers: !!window.firebaseHelpers
            });
        }
    };

    // ─────────────────────────────────────────────
    // Auth
    // ─────────────────────────────────────────────

    const Auth = {
        /**
         * Login: fetch user from Firestore using username and verify password.
         * Always fetches fresh from Firestore to prevent cross-device conflicts.
         * Returns { success, user } or { success: false, error }.
         */
        async loginAsync(username, password) {
            try {
                console.log('🔐 LOGIN ATTEMPT:', { username, passwordLength: password.length });
                await waitForFirebase();
                const trimmedUsername = username.trim();
                const trimmedPassword = password.trim();
                
                console.log('📝 TRIMMED VALUES:', { trimmedUsername, trimmedPasswordLength: trimmedPassword.length });
                
                // Always query Firebase for the latest user data
                const snap = await fsGetDocs(
                    fsQuery(fsCol('users'), fsWhere('username', '==', trimmedUsername))
                );
                
                console.log('🔍 FIRESTORE QUERY RESULT:', { 
                    empty: snap.empty, 
                    docsCount: snap.docs.length,
                    firebaseReady: window.__FIREBASE_INIT_DONE
                });
                
                if (snap.empty) {
                    console.error('❌ LOGIN FAILED: User not found for username:', trimmedUsername);
                    console.log('Available usernames in Firestore for debugging:', snap);
                    return { success: false, error: 'User not found.' };
                }
                
                const userData = snap.docs[0].data();
                console.log('✅ USER FOUND:', { 
                    id: userData.id, 
                    username: userData.username,
                    storedPasswordLength: userData.password ? userData.password.length : 'UNDEFINED',
                    role: userData.role
                });
                
                // Verify password matches exactly
                console.log('🔐 PASSWORD CHECK:', {
                    provided: trimmedPassword,
                    stored: userData.password,
                    match: userData.password === trimmedPassword,
                    providedLength: trimmedPassword.length,
                    storedLength: userData.password ? userData.password.length : 0,
                    providedBytes: Array.from(trimmedPassword).map(c => c.charCodeAt(0)),
                    storedBytes: userData.password ? Array.from(userData.password).map(c => c.charCodeAt(0)) : []
                });
                
                if (userData.password !== trimmedPassword) {
                    console.error('❌ LOGIN FAILED: Password mismatch for username:', trimmedUsername);
                    console.error('Password comparison failed');
                    return { success: false, error: 'Incorrect password.' };
                }
                
                // Store only the current session user in localStorage
                localStorage.setItem('currentUser', JSON.stringify(userData));
                console.log('✅ LOGIN SUCCESSFUL for user:', userData.id, userData.username);
                return { success: true, user: userData };
            } catch (err) {
                console.error('❌ loginAsync EXCEPTION:', err);
                console.error('Stack trace:', err.stack);
                return { success: false, error: 'Login failed. Check your connection. Error: ' + err.message };
            }
        },

        logout() {
            localStorage.removeItem('currentUser');
        },

        /**
         * Create a new student account in Firestore.
         * Returns { success, user } or { success: false, error }.
         */
        async signup(username, password, name, level) {
            try {
                await waitForFirebase();
                // Check username uniqueness
                const existing = await fsGetDocs(
                    fsQuery(fsCol('users'), fsWhere('username', '==', username.trim()))
                );
                if (!existing.empty) {
                    return { success: false, error: 'Username already taken.' };
                }
                const newUser = {
                    id: uid(),
                    username: username.trim(),
                    password,
                    name: name.trim(),
                    level,
                    role: 'student',
                    createdAt: nowISO()
                };
                await fsSetDoc(fsDoc('users', newUser.id), newUser);
                return { success: true, user: newUser };
            } catch (err) {
                console.error('signup error', err);
                return { success: false, error: 'Could not create student. Check connection.' };
            }
        },

        /**
         * Update an existing student in Firestore.
         * Returns { success } or { success: false, error }.
         */
        async updateStudent(studentId, fields) {
            try {
                await waitForFirebase();
                // Check username uniqueness if username changed
                if (fields.username) {
                    const existing = await fsGetDocs(
                        fsQuery(fsCol('users'), fsWhere('username', '==', fields.username.trim()))
                    );
                    const conflict = existing.docs.find(d => d.id !== studentId);
                    if (conflict) {
                        return { success: false, error: 'Username already taken by another student.' };
                    }
                }
                const update = {
                    name: fields.name.trim(),
                    username: fields.username.trim(),
                    level: fields.level,
                    updatedAt: nowISO()
                };
                if (fields.password && fields.password.trim() !== '') {
                    update.password = fields.password.trim();
                }
                await fsSetDoc(fsDoc('users', studentId), update, { merge: true });
                return { success: true };
            } catch (err) {
                console.error('updateStudent error', err);
                return { success: false, error: 'Could not update student. Check connection.' };
            }
        },

        /**
         * Delete a student from Firestore (their progress records are kept for audit).
         * Returns { success } or { success: false, error }.
         */
        async deleteStudent(studentId) {
            try {
                await waitForFirebase();
                await fsDeleteDoc(fsDoc('users', studentId));
                return { success: true };
            } catch (err) {
                console.error('deleteStudent error', err);
                return { success: false, error: 'Could not delete student. Check connection.' };
            }
        },

        /**
         * Returns the cached student list from the last getStudents() call.
         * Synchronous, so UI can render immediately; call refreshStudents() to update.
         */
        getStudents() {
            return Auth._cachedStudents || [];
        },

        /**
         * Fetch all students from Firestore and cache them.
         * Returns array of student objects.
         */
        async refreshStudents() {
            try {
                await waitForFirebase();
                const snap = await fsGetDocs(
                    fsQuery(fsCol('users'), fsWhere('role', '==', 'student'))
                );
                const students = snap.docs.map(d => d.data());
                Auth._cachedStudents = students;
                return students;
            } catch (err) {
                console.error('refreshStudents error', err);
                return Auth._cachedStudents || [];
            }
        },

        _cachedStudents: []
    };

    // ─────────────────────────────────────────────
    // Progress
    // ─────────────────────────────────────────────

    const Progress = {
        /**
         * Record a practice attempt (student pressed Play from the beginning).
         * type = 'attempt', completed = false
         */
        async recordPracticeAttempt(userId, practiceKind, title, level) {
            try {
                await waitForFirebase();
                const rec = {
                    id: uid(),
                    userId,
                    type: 'attempt',
                    completed: false,
                    practiceKind,   // 'passage' | 'spelling'
                    title,
                    level,
                    date: nowISO()
                };
                await fsSetDoc(fsDoc('progressRecords', rec.id), rec);
            } catch (err) {
                console.error('recordPracticeAttempt error', err);
            }
        },

        /**
         * Record a practice completion (audio finished playing naturally).
         * type = 'practice', completed = true
         */
        async recordPracticeCompletion(userId, practiceKind, title, level) {
            try {
                await waitForFirebase();
                const rec = {
                    id: uid(),
                    userId,
                    type: 'practice',
                    completed: true,
                    practiceKind,
                    title,
                    level,
                    date: nowISO()
                };
                await fsSetDoc(fsDoc('progressRecords', rec.id), rec);
            } catch (err) {
                console.error('recordPracticeCompletion error', err);
            }
        },

        /**
         * Fetch all progress records for a student from Firestore.
         * Returns array of record objects, sorted newest-first.
         */
        async fetchStudentProgress(userId) {
            try {
                await waitForFirebase();
                const snap = await fsGetDocs(
                    fsQuery(fsCol('progressRecords'), fsWhere('userId', '==', userId))
                );
                const records = snap.docs.map(d => d.data());
                records.sort((a, b) => new Date(b.date) - new Date(a.date));
                // Cache for synchronous callers
                Progress._cache[userId] = records;
                return records;
            } catch (err) {
                console.error('fetchStudentProgress error', err);
                return Progress._cache[userId] || [];
            }
        },

        /**
         * Synchronous accessor — returns the last-fetched cache for a user.
         * Always call fetchStudentProgress() first if you need live data.
         */
        getStudentProgress(userId) {
            return Progress._cache[userId] || [];
        },

        /**
         * Returns history data shaped for the teacher history modal:
         * { rawRecords, groupedRecords }
         * rawRecords = completed practice records only
         * groupedRecords = de-duped groups with count + lastPlayedAt
         */
        getStudentPracticeHistory(userId) {
            const all = Progress._cache[userId] || [];
            const rawRecords = all.filter(r => r.type === 'practice' && r.completed);

            // Group by practiceKind + title + level
            const groups = {};
            rawRecords.forEach(r => {
                const key = `${r.practiceKind}||${r.title}||${r.level}`;
                if (!groups[key]) {
                    groups[key] = {
                        practiceKind: r.practiceKind,
                        title: r.title,
                        level: r.level,
                        count: 0,
                        lastPlayedAt: null,
                        records: []
                    };
                }
                groups[key].count++;
                groups[key].records.push(r);
                if (!groups[key].lastPlayedAt || r.date > groups[key].lastPlayedAt) {
                    groups[key].lastPlayedAt = r.date;
                }
            });

            const groupedRecords = Object.values(groups).sort(
                (a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt)
            );

            return { rawRecords, groupedRecords };
        },

        /**
         * Basic stats for teacher table (quiz data not yet implemented).
         */
        getStudentStats(userId) {
            return { totalQuizzes: 0, averageQuizScore: 0 };
        },

        /**
         * Returns all student activities across all cached students,
         * sorted newest-first. Used by the teacher activity feed.
         */
        getAllStudentActivities() {
            const students = Auth.getStudents();
            const activities = [];

            students.forEach(student => {
                const records = Progress._cache[student.id] || [];
                records.forEach(r => {
                    activities.push({
                        studentName: student.name,
                        activityType: r.practiceKind === 'spelling' ? 'Spelling' : 'Passage',
                        title: r.title,
                        date: r.date,
                        isAttempt: !r.completed
                    });
                });
            });

            activities.sort((a, b) => new Date(b.date) - new Date(a.date));
            return activities.slice(0, 50); // cap at 50 for performance
        },

        /**
         * Returns the count of completed listening records for a student directly
         * from Firestore (used for teacher dashboard listen count column).
         * ALWAYS fetches fresh from Firestore, no cache.
         */
        async getListeningCountFromFirebase(userId) {
            try {
                await waitForFirebase();
                const snap = await fsGetDocs(
                    fsQuery(
                        fsCol('progressRecords'),
                        fsWhere('userId', '==', userId),
                        fsWhere('completed', '==', true)
                    )
                );
                console.log('Fetched listening count for user', userId, ':', snap.size);
                return snap.size;
            } catch (err) {
                console.error('getListeningCountFromFirebase error', err);
                return 0;
            }
        },

        /**
         * Clears all internal caches. Call this when you need fresh data.
         */
        clearCache() {
            Progress._cache = {};
            console.log('Progress cache cleared');
        },

        _cache: {}   // { [userId]: recordArray }
    };

    // ─────────────────────────────────────────────
    // CloudStore  (bootstrap only — no pushAll/pullAll)
    // ─────────────────────────────────────────────

    const CloudStore = {
        /**
         * Called once on page load.
         * 1. Initialises Firebase.
         * 2. Seeds the teacher account if it doesn't exist yet.
         * 3. Loads all students and all progress into memory so
         *    synchronous callers (getStudents, getStudentProgress) work immediately.
         */
        async bootstrap() {
            // Initialise Firebase (defined in firebase.js)
            if (typeof window.firebaseInit === 'function') {
                await window.firebaseInit();
            }

            if (!window.__FIREBASE_INIT_DONE) {
                console.warn('CloudStore.bootstrap: Firebase not ready — running offline.');
                return false;
            }

            // Seed teacher account if it doesn't exist
            await CloudStore._seedTeacher();

            // Pre-load all students
            await Auth.refreshStudents();

            // Pre-load all progress records for all students
            const students = Auth.getStudents();
            await Promise.all(students.map(s => Progress.fetchStudentProgress(s.id)));

            console.log('CloudStore.bootstrap complete');
            return true;
        },

        /**
         * Creates the default teacher account in Firestore if not already present.
         * Change TEACHER_USERNAME / TEACHER_PASSWORD below to your preferred credentials.
         */
        async _seedTeacher() {
            const TEACHER_USERNAME = 'teacher';
            const TEACHER_PASSWORD = 'admin123';

            try {
                console.log('🌱 SEEDING TEACHER ACCOUNT...');
                const snap = await fsGetDocs(
                    fsQuery(fsCol('users'), fsWhere('role', '==', 'teacher'))
                );
                
                if (!snap.empty) {
                    console.log('✅ TEACHER ACCOUNT ALREADY EXISTS:', snap.docs[0].data());
                    return;
                }

                const teacher = {
                    id: uid(),
                    username: TEACHER_USERNAME,
                    password: TEACHER_PASSWORD,
                    name: '陈老师',
                    role: 'teacher',
                    level: 'TEACHER',
                    createdAt: nowISO()
                };
                
                console.log('📝 CREATING NEW TEACHER ACCOUNT:', { username: TEACHER_USERNAME, password: TEACHER_PASSWORD });
                await fsSetDoc(fsDoc('users', teacher.id), teacher);
                console.log('✅ DEFAULT TEACHER ACCOUNT CREATED:', TEACHER_USERNAME, '/', TEACHER_PASSWORD);
            } catch (err) {
                console.error('❌ _seedTeacher error', err);
            }
        },

        /**
         * Refresh all data from Firestore into memory caches.
         * Called by refreshSessionFromCloud() in app.html.
         */
        async pullAll() {
            if (!window.__FIREBASE_INIT_DONE) return false;
            try {
                await Auth.refreshStudents();
                const students = Auth.getStudents();
                await Promise.all(students.map(s => Progress.fetchStudentProgress(s.id)));

                // Also refresh the current user from Firestore
                const currentUserJson = localStorage.getItem('currentUser');
                if (currentUserJson) {
                    const cached = JSON.parse(currentUserJson);
                    const snap = await fsGetDocs(
                        fsQuery(fsCol('users'), fsWhere('id', '==', cached.id))
                    );
                    if (!snap.empty) {
                        const fresh = snap.docs[0].data();
                        localStorage.setItem('currentUser', JSON.stringify(fresh));
                    } else {
                        // User was deleted
                        localStorage.removeItem('currentUser');
                    }
                }

                localStorage.setItem('lastSync', nowISO());
                return true;
            } catch (err) {
                console.error('CloudStore.pullAll error', err);
                return false;
            }
        }
    };

    // ─────────────────────────────────────────────
    // Expose globals
    // ─────────────────────────────────────────────

    window.Auth = Auth;
    window.Progress = Progress;
    window.CloudStore = CloudStore;
    window.Debug = Debug;

})();