// =====================================================
// auth.js - Fixed Version
// Single source of truth: Firebase
// localStorage used only for session cache
// Wallet/points system fully removed
// =====================================================

// =====================================================
// Firebase Cloud Store
// =====================================================
class CloudStore {
    static fs = null;
    static isOnline = navigator.onLine;
    static syncInProgress = false;

    static async bootstrap() {
        const ready = await firestoreReady;
        if (!ready) {
            console.warn('Firestore imports failed, skipping bootstrap');
            return false;
        }

        if (typeof firebase === 'undefined' || !firebase.firestore) {
            console.warn('Firebase not loaded');
            return false;
        }

        this.fs = firebase.firestore();

        window.addEventListener('online', () => {
            this.isOnline = true;
            this.pullAll();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });

        await this.pullAll();
        return true;
    }

    // Pull all data from Firebase into localStorage cache
    static async pullAll() {
        const ready = await firestoreReady;
        if (!ready) return false;
        if (!this.fs || !this.isOnline) return false;
        if (this.syncInProgress) return false;

        this.syncInProgress = true;

        try {
            // Pull users
            const usersSnap = await getDocs(collection(this.fs, 'users'));
            const users = [];
            usersSnap.forEach(doc => {
                users.push({ id: doc.id, ...doc.data() });
            });
            localStorage.setItem('users', JSON.stringify(users));

            // Pull progress records
            const progressSnap = await getDocs(collection(this.fs, 'progressRecords'));
            const progress = {};
            progressSnap.forEach(doc => {
                const record = { id: doc.id, ...doc.data() };
                const userId = record.userId;
                if (!userId) return;
                if (!progress[userId]) progress[userId] = [];
                // Deduplicate by id
                if (!progress[userId].find(r => r.id === record.id)) {
                    progress[userId].push(record);
                }
            });
            localStorage.setItem('progress', JSON.stringify(progress));
            localStorage.setItem('lastSync', new Date().toISOString());

            this.syncInProgress = false;
            return true;
        } catch (error) {
            console.error('Pull failed:', error);
            this.syncInProgress = false;
            return false;
        }
    }

    // Push a single new record to Firebase by id (no full pushAll)
    static async pushRecord(collectionName, record) {
        const ready = await firestoreReady;
        if (!ready) return false;
        if (!this.fs) return false;
        try {
            await setDoc(doc(this.fs, collectionName, record.id), record);
            return true;
        } catch (error) {
            console.error('Push record failed:', error);
            return false;
        }
    }

    static async pushUser(user) {
        return this.pushRecord('users', user);
    }

    static async pushProgressRecord(record) {
        return this.pushRecord('progressRecords', record);
    }

    // Delete document from Firebase
    static async deleteDocument(collectionName, docId) {
        const ready = await firestoreReady;
        if (!ready) return false;
        if (!this.fs) return false;
        try {
            await deleteDoc(doc(this.fs, collectionName, docId));
            return true;
        } catch (error) {
            console.error('Delete failed:', error);
            return false;
        }
    }

    // Delete all progress records for a user from Firebase
    static async deleteUserProgress(userId) {
        const ready = await firestoreReady;
        if (!ready) return false;
        if (!this.fs) return false;
        try {
            const q = query(
                collection(this.fs, 'progressRecords'),
                where('userId', '==', userId)
            );
            const snapshot = await getDocs(q);
            const deletePromises = snapshot.docs.map(docSnap =>
                deleteDoc(doc(this.fs, 'progressRecords', docSnap.id))
            );
            await Promise.all(deletePromises);
            return true;
        } catch (error) {
            console.error('Delete user progress failed:', error);
            return false;
        }
    }

    // Get listening count from Firebase (passage + spelling completed only)
    static async getListeningCount(userId) {
        const ready = await firestoreReady;
        if (!ready) return 0;
        if (!this.fs) return 0;
        try {
            const q = query(
                collection(this.fs, 'progressRecords'),
                where('userId', '==', userId),
                where('type', '==', 'practice'),
                where('completed', '==', true)
            );
            const snapshot = await getDocs(q);
            const validRecords = snapshot.docs
                .map(d => d.data())
                .filter(r =>
                    r.practiceKind === 'passage' || r.practiceKind === 'spelling'
                );
            return validRecords.length;
        } catch (error) {
            console.error('Get listening count failed:', error);
            return 0;
        }
    }

    static async getPassageCount(userId) {
        const ready = await firestoreReady;
        if (!ready) return 0;
        if (!this.fs) return 0;
        try {
            const q = query(
                collection(this.fs, 'progressRecords'),
                where('userId', '==', userId),
                where('type', '==', 'practice'),
                where('practiceKind', '==', 'passage'),
                where('completed', '==', true)
            );
            const snapshot = await getDocs(q);
            return snapshot.size;
        } catch (error) {
            console.error('Get passage count failed:', error);
            return 0;
        }
    }

    static async getSpellingCount(userId) {
        const ready = await firestoreReady;
        if (!ready) return 0;
        if (!this.fs) return 0;
        try {
            const q = query(
                collection(this.fs, 'progressRecords'),
                where('userId', '==', userId),
                where('type', '==', 'practice'),
                where('practiceKind', '==', 'spelling'),
                where('completed', '==', true)
            );
            const snapshot = await getDocs(q);
            return snapshot.size;
        } catch (error) {
            console.error('Get spelling count failed:', error);
            return 0;
        }
    }
}

// Firebase Firestore helpers
let collection, query, where, getDocs, setDoc, doc, deleteDoc;

// Replaced floating IIFE with a proper promise that resolves when imports are ready
const firestoreReady = (async () => {
    try {
        const firestore = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        collection = firestore.collection;
        query = firestore.query;
        where = firestore.where;
        getDocs = firestore.getDocs;
        setDoc = firestore.setDoc;
        doc = firestore.doc;
        deleteDoc = firestore.deleteDoc;
        return true;
    } catch (e) {
        console.warn('Firestore imports failed:', e);
        return false;
    }
})();

// =====================================================
// Authentication
// =====================================================
class Auth {
    static init() {
        if (!localStorage.getItem('users')) {
            localStorage.setItem('users', JSON.stringify([]));
        }
        if (!localStorage.getItem('progress')) {
            localStorage.setItem('progress', JSON.stringify({}));
        }

        // Create default teacher if no users exist
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        if (users.length === 0) {
            const teacher = {
                id: 'teacher_' + Date.now(),
                username: 'teacher',
                password: 'teacher123',
                name: 'Teacher',
                role: 'teacher',
                createdAt: new Date().toISOString()
            };
            users.push(teacher);
            localStorage.setItem('users', JSON.stringify(users));
            CloudStore.pushUser(teacher); // Async, safely waits for firestoreReady internally
        }
    }

    static async loginAsync(username, password) {
        await CloudStore.pullAll();
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            localStorage.setItem('currentUser', JSON.stringify(user));
            return { success: true, user };
        }
        return { success: false, error: 'Invalid credentials' };
    }

    static login(username, password) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            localStorage.setItem('currentUser', JSON.stringify(user));
            return { success: true, user };
        }
        return { success: false, error: 'Invalid credentials' };
    }

    static logout() {
        localStorage.removeItem('currentUser');
    }

    static getCurrentUser() {
        const userJSON = localStorage.getItem('currentUser');
        return userJSON ? JSON.parse(userJSON) : null;
    }

    static signup(username, password, name, level) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');

        if (users.find(u => u.username === username)) {
            return { success: false, error: 'Username already exists' };
        }

        const newStudent = {
            id: 'student_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            username,
            password,
            name,
            level,
            role: 'student',
            createdAt: new Date().toISOString()
        };

        users.push(newStudent);
        localStorage.setItem('users', JSON.stringify(users));

        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        progress[newStudent.id] = [];
        localStorage.setItem('progress', JSON.stringify(progress));

        // Push user to Firebase only once
        CloudStore.pushUser(newStudent);

        return { success: true, user: newStudent };
    }

    static getStudents() {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        return users.filter(u => u.role === 'student');
    }

    static updateStudent(studentId, updates) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const index = users.findIndex(u => u.id === studentId);

        if (index === -1) {
            return { success: false, error: 'Student not found' };
        }

        if (updates.username && updates.username !== users[index].username) {
            if (users.find(u => u.username === updates.username && u.id !== studentId)) {
                return { success: false, error: 'Username already exists' };
            }
        }

        if (updates.name) users[index].name = updates.name;
        if (updates.username) users[index].username = updates.username;
        if (updates.password) users[index].password = updates.password;
        if (updates.level) users[index].level = updates.level;
        users[index].updatedAt = new Date().toISOString();

        localStorage.setItem('users', JSON.stringify(users));

        const currentUser = this.getCurrentUser();
        if (currentUser && currentUser.id === studentId) {
            localStorage.setItem('currentUser', JSON.stringify(users[index]));
        }

        CloudStore.pushUser(users[index]);
        return { success: true, user: users[index] };
    }

    static async deleteStudent(studentId) {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const index = users.findIndex(u => u.id === studentId);

        if (index === -1) {
            return { success: false, error: 'Student not found' };
        }

        users.splice(index, 1);
        localStorage.setItem('users', JSON.stringify(users));

        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        delete progress[studentId];
        localStorage.setItem('progress', JSON.stringify(progress));

        // Delete from Firebase
        await CloudStore.deleteDocument('users', studentId);
        await CloudStore.deleteUserProgress(studentId);

        return { success: true };
    }
}

// =====================================================
// Progress Tracking (No Points / No Wallet)
// =====================================================
class Progress {
    // Record that student started listening (attempt)
    static async recordPracticeAttempt(userId, practiceKind, title, level) {
        const record = {
            id: `attempt_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            type: 'practice',
            practiceKind,
            title,
            level,
            completed: false,
            date: new Date().toISOString()
        };

        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        if (!progress[userId]) progress[userId] = [];
        progress[userId].push(record);
        localStorage.setItem('progress', JSON.stringify(progress));

        // Push only this new record to Firebase
        await CloudStore.pushProgressRecord(record);

        return record;
    }

    // Record that student completed listening
    static async recordPracticeCompletion(userId, practiceKind, title, level) {
        const record = {
            id: `practice_${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            userId,
            type: 'practice',
            practiceKind,
            title,
            level,
            completed: true,
            date: new Date().toISOString()
        };

        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        if (!progress[userId]) progress[userId] = [];
        progress[userId].push(record);
        localStorage.setItem('progress', JSON.stringify(progress));

        // Push only this new record to Firebase
        await CloudStore.pushProgressRecord(record);

        return record;
    }

    // Get all progress for a student from local cache
    static getStudentProgress(userId) {
        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        return progress[userId] || [];
    }

    // Get practice history grouped by lesson
    static getStudentPracticeHistory(userId) {
        const allRecords = this.getStudentProgress(userId);
        const practiceRecords = allRecords.filter(r =>
            r.type === 'practice' &&
            r.completed === true &&
            (r.practiceKind === 'passage' || r.practiceKind === 'spelling')
        );

        const grouped = {};
        practiceRecords.forEach(record => {
            const key = `${record.practiceKind}_${record.title}_${record.level}`;
            if (!grouped[key]) {
                grouped[key] = {
                    practiceKind: record.practiceKind,
                    title: record.title,
                    level: record.level,
                    count: 0,
                    records: [],
                    lastPlayedAt: null
                };
            }
            grouped[key].count++;
            grouped[key].records.push(record);

            const recordDate = new Date(record.date);
            if (!grouped[key].lastPlayedAt || recordDate > new Date(grouped[key].lastPlayedAt)) {
                grouped[key].lastPlayedAt = record.date;
            }
        });

        return {
            rawRecords: practiceRecords,
            groupedRecords: Object.values(grouped).sort((a, b) =>
                new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt)
            )
        };
    }

    // Get listening count from Firebase
    static async getListeningCountFromFirebase(userId) {
        return CloudStore.getListeningCount(userId);
    }

    // Get student stats
    static getStudentStats(userId) {
        const allRecords = this.getStudentProgress(userId);

        const quizRecords = allRecords.filter(r => r.type === 'Quiz');
        const totalQuizzes = quizRecords.length;
        const averageQuizScore = totalQuizzes > 0
            ? Math.round(quizRecords.reduce((sum, r) => sum + (r.score || 0), 0) / totalQuizzes)
            : 0;

        const practiceRecords = allRecords.filter(r =>
            r.type === 'practice' &&
            r.completed === true &&
            (r.practiceKind === 'passage' || r.practiceKind === 'spelling')
        );

        return {
            totalQuizzes,
            averageQuizScore,
            totalPractices: practiceRecords.length,
            passageCount: practiceRecords.filter(r => r.practiceKind === 'passage').length,
            spellingCount: practiceRecords.filter(r => r.practiceKind === 'spelling').length
        };
    }

    // Get all student activities for teacher dashboard
    static getAllStudentActivities() {
        const users = JSON.parse(localStorage.getItem('users') || '[]');
        const progress = JSON.parse(localStorage.getItem('progress') || '{}');
        const activities = [];

        users.filter(u => u.role === 'student').forEach(student => {
            const studentProgress = progress[student.id] || [];

            studentProgress.forEach(record => {
                if (record.type === 'practice' && record.completed) {
                    activities.push({
                        studentName: student.name,
                        studentId: student.id,
                        activityType: record.practiceKind === 'passage' ? 'Passage' : 'Spelling',
                        title: record.title,
                        date: record.date,
                        isAttempt: false
                    });
                } else if (record.type === 'practice' && !record.completed) {
                    activities.push({
                        studentName: student.name,
                        studentId: student.id,
                        activityType: record.practiceKind === 'passage' ? 'Passage' : 'Spelling',
                        title: record.title,
                        date: record.date,
                        isAttempt: true
                    });
                } else if (record.type === 'Quiz' || record.type === 'Game') {
                    activities.push({
                        studentName: student.name,
                        studentId: student.id,
                        activityType: record.type,
                        title: record.title || record.type,
                        score: record.score,
                        date: record.date
                    });
                }
            });
        });

        return activities.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
    }
}

// =====================================================
// Initialize on load
// =====================================================
Auth.init();

window.CloudStore = CloudStore;
window.Auth = Auth;
window.Progress = Progress;