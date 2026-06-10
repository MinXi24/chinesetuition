// Authentication & User Management with localStorage

class CloudStore {
  static async waitForFirebaseApi(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (window.firebaseInit) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  static async ensureReady() {
    const apiReady = await this.waitForFirebaseApi();
    if (!apiReady) {
      return false;
    }

    await window.firebaseInit();
    return !!window.firestore;
  }

  static normalizeProgress(progress) {
    let changed = false;

    Object.entries(progress).forEach(([userId, records]) => {
      records.forEach(record => {
        if (!record.id) {
          record.id = `${record.type || 'record'}_${userId}_${record.date || Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          changed = true;
        }
      });
    });

    if (changed) {
      localStorage.setItem('progress', JSON.stringify(progress));
    }

    return progress;
  }

  static getLocalState() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    const progress = this.normalizeProgress(JSON.parse(localStorage.getItem('progress') || '{}'));
    return { users, wallets, progress };
  }

  static async pullAll() {
    if (!(await this.ensureReady())) {
      return false;
    }

    const { collection, getDocs } = window.firebaseHelpers;
    const fs = window.firestore;
    const localState = this.getLocalState();

    const [usersSnap, walletsSnap, progressSnap] = await Promise.all([
      getDocs(collection(fs, 'users')),
      getDocs(collection(fs, 'wallets')),
      getDocs(collection(fs, 'progressRecords'))
    ]);

    if (usersSnap.empty && walletsSnap.empty && progressSnap.empty) {
      return false;
    }

    const usersById = new Map(localState.users.filter(user => user && user.id).map(user => [user.id, user]));
    usersSnap.docs.forEach(item => {
      const data = item.data();
      const user = Object.assign({}, data, { id: data.id || item.id });
      usersById.set(user.id, user);
    });
    const users = Array.from(usersById.values());

    const wallets = Object.assign({}, localState.wallets);
    walletsSnap.docs.forEach(item => {
      wallets[item.id] = Object.assign({}, wallets[item.id] || {}, item.data());
    });

    const progressByUser = Object.entries(localState.progress).reduce((accumulator, [userId, records]) => {
      accumulator[userId] = Array.isArray(records) ? records.map(record => Object.assign({}, record)) : [];
      return accumulator;
    }, {});
    // Merge incoming progress records into local state with deduplication.
    // Strategy:
    // - If incoming record.id matches an existing record => merge, prefer newest date and claimed flag.
    // - Else attempt to match by (practiceKind + title + level) within a 2-minute window and merge as duplicate.
    // - Otherwise append as new record.
    progressSnap.docs.forEach(item => {
      const record = item.data();
      if (!record.userId) return;
      if (!progressByUser[record.userId]) progressByUser[record.userId] = [];

      const userRecords = progressByUser[record.userId];
      // try id match first
      if (record.id) {
        const idx = userRecords.findIndex(r => r.id === record.id);
        if (idx !== -1) {
          // merge, prefer fields from the newest record
          const existing = userRecords[idx];
          const existingTime = existing.date ? Date.parse(existing.date) : 0;
          const incomingTime = record.date ? Date.parse(record.date) : 0;
          const merged = Object.assign({}, existing, record);
          // keep claimed if either says claimed
          merged.claimed = !!existing.claimed || !!record.claimed;
          // prefer newest date
          merged.date = incomingTime >= existingTime ? record.date : existing.date;
          userRecords[idx] = merged;
          return;
        }
      }

      // try heuristic match: same practiceKind+title+level within 2 minutes
      const windowMs = 2 * 60 * 1000;
      const keyMatch = userRecords.findIndex(r => {
        try {
          const sameKind = (r.practiceKind || '') === (record.practiceKind || '');
          const sameTitle = (r.title || '').trim() === (record.title || '').trim();
          const sameLevel = (r.level || '') === (record.level || '');
          if (!sameKind || !sameTitle) return false;
          if (!record.date || !r.date) return false;
          return Math.abs(Date.parse(r.date) - Date.parse(record.date)) <= windowMs;
        } catch (e) {
          return false;
        }
      });

      if (keyMatch !== -1) {
        const existing = userRecords[keyMatch];
        const existingTime = existing.date ? Date.parse(existing.date) : 0;
        const incomingTime = record.date ? Date.parse(record.date) : 0;
        const merged = Object.assign({}, existing, record);
        merged.claimed = !!existing.claimed || !!record.claimed;
        merged.date = incomingTime >= existingTime ? record.date : existing.date;
        // keep existing id if present, otherwise take incoming id
        merged.id = existing.id || record.id || `record_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        userRecords[keyMatch] = merged;
        return;
      }

      // otherwise append
      userRecords.push(record);
    });

    Object.keys(progressByUser).forEach(userId => {
      progressByUser[userId].sort((a, b) => new Date(a.date) - new Date(b.date));
    });

    localStorage.setItem('users', JSON.stringify(users));
    localStorage.setItem('wallets', JSON.stringify(wallets));
    localStorage.setItem('progress', JSON.stringify(progressByUser));
    try {
      localStorage.setItem('lastSync', new Date().toISOString());
      localStorage.removeItem('pendingSync');
    } catch (e) {
      console.warn('Unable to write lastSync to localStorage', e);
    }
    return true;
  }

  static async pullUsersOnly() {
    if (!(await this.ensureReady())) {
      return false;
    }

    const { collection, getDocs } = window.firebaseHelpers;
    const fs = window.firestore;
    const usersSnap = await getDocs(collection(fs, 'users'));

    if (usersSnap.empty) {
      return false;
    }

    const users = usersSnap.docs.map(item => {
      const data = item.data();
      return Object.assign({}, data, { id: data.id || item.id });
    });

    localStorage.setItem('users', JSON.stringify(users));
    return true;
  }

  static async pushAll() {
    console.log('[pushAll] Starting...');
    if (!(await this.ensureReady())) {
      console.warn('[pushAll] Firebase not ready');
      return false;
    }

    const { doc, setDoc } = window.firebaseHelpers;
    const fs = window.firestore;
    const state = this.getLocalState();
    console.log('[pushAll] Local state:', {
      usersCount: state.users.length,
      walletsCount: Object.keys(state.wallets).length,
      progressCount: Object.keys(state.progress).length
    });

    try {
      await Promise.all(state.users.filter(user => user.id).map(user => setDoc(doc(fs, 'users', user.id), user)));
      console.log('[pushAll] Users pushed');

      await Promise.all(Object.entries(state.wallets).map(([userId, wallet]) => setDoc(doc(fs, 'wallets', userId), wallet)));
      console.log('[pushAll] Wallets pushed');

      const localProgressRecords = [];
      Object.entries(state.progress).forEach(([userId, records]) => {
        records.forEach(record => {
          localProgressRecords.push(Object.assign({}, record, { userId }));
        });
      });
      console.log('[pushAll] Progress records to push:', localProgressRecords.length);

      await Promise.all(localProgressRecords.map(record => {
        if (!record.id) {
          record.id = `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        return setDoc(doc(fs, 'progressRecords', record.id), record);
      }));
      console.log('[pushAll] Progress records pushed');

      try {
        localStorage.setItem('lastSync', new Date().toISOString());
        localStorage.removeItem('pendingSync');
      } catch (e) {
        console.warn('Unable to write lastSync to localStorage', e);
      }
      console.log('[pushAll] SUCCESS');
      return true;
    } catch (e) {
      console.error('[pushAll] FAILED:', e);
      return false;
    }
  }

  static async pushListeningRecord(userId, practiceKind, title, level) {
    console.log('[pushListeningRecord] Called for userId:', userId, 'practiceKind:', practiceKind, 'title:', title);
    
    if (!(await this.ensureReady())) {
      console.warn('[pushListeningRecord] Firebase not ready');
      return false;
    }

    try {
      const { doc, setDoc } = window.firebaseHelpers;
      const fs = window.firestore;
      
      const listeningRecord = {
        userId,
        practiceKind,
        title,
        level,
        timestamp: new Date().toISOString(),
        deviceId: localStorage.getItem('deviceId') || 'unknown'
      };

      const recordId = `listen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      console.log('[pushListeningRecord] Pushing record:', recordId, listeningRecord);
      
      await setDoc(doc(fs, 'listeningHistory', recordId), listeningRecord);
      console.log('[pushListeningRecord] SUCCESS - record pushed:', recordId);
      return true;
    } catch (e) {
      console.error('[pushListeningRecord] FAILED:', e);
      return false;
    }
  }

  static async getListeningCount(userId) {
    console.log('[getListeningCount] Fetching for userId:', userId);
    
    if (!(await this.ensureReady())) {
      console.warn('[getListeningCount] Firebase not ready');
      return 0;
    }

    try {
      const { collection, getDocs, query, where } = window.firebaseHelpers;
      const fs = window.firestore;
      
      const q = query(collection(fs, 'listeningHistory'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      
      const count = querySnapshot.size;
      console.log('[getListeningCount] Found', count, 'records for userId:', userId);
      return count;
    } catch (e) {
      console.error('[getListeningCount] FAILED:', e);
      return 0;
    }
  }

  static async getListeningCountByPractice(userId) {
    if (!(await this.ensureReady())) {
      console.warn('Firebase not ready for getListeningCountByPractice');
      return {};
    }

    try {
      const { collection, getDocs, query, where } = window.firebaseHelpers;
      const fs = window.firestore;
      
      const q = query(collection(fs, 'listeningHistory'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      
      const countByPractice = {};
      querySnapshot.docs.forEach(doc => {
        const data = doc.data();
        const key = `${data.practiceKind}::${data.title}`;
        countByPractice[key] = (countByPractice[key] || 0) + 1;
      });
      
      console.log(`Listening counts by practice for ${userId}:`, countByPractice);
      return countByPractice;
    } catch (e) {
      console.error('Failed to get listening count by practice from Firebase:', e);
      return {};
    }
  }

  static async getAllListeningRecords(userId) {
    if (!(await this.ensureReady())) {
      console.warn('Firebase not ready for getAllListeningRecords');
      return [];
    }

    try {
      const { collection, getDocs, query, where } = window.firebaseHelpers;
      const fs = window.firestore;
      
      const q = query(collection(fs, 'listeningHistory'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      
      const records = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log(`Retrieved ${records.length} listening records for ${userId}:`, records);
      return records;
    } catch (e) {
      console.error('Failed to get listening records from Firebase:', e);
      return [];
    }
  }

  static async debugShowAllData(userId) {
    console.log('========== FIREBASE DEBUG INFO ==========');
    console.log('User ID:', userId);
    
    // Check local storage
    const localProgress = JSON.parse(localStorage.getItem('progress') || '{}');
    const localRecords = localProgress[userId] || [];
    console.log('Local localStorage records for user:', localRecords.length, localRecords);
    
    // Check listening history in Firebase
    const listeningRecords = await this.getAllListeningRecords(userId);
    console.log('Firebase listeningHistory records:', listeningRecords.length);
    
    // Check progressRecords in Firebase
    if (!(await this.ensureReady())) {
      console.warn('Firebase not ready');
      return;
    }
    
    try {
      const { collection, getDocs, query, where } = window.firebaseHelpers;
      const fs = window.firestore;
      
      const q = query(collection(fs, 'progressRecords'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
      const progressRecords = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('Firebase progressRecords for user:', progressRecords.length, progressRecords);
    } catch (e) {
      console.error('Error fetching progressRecords:', e);
    }
    
    console.log('Last Sync:', localStorage.getItem('lastSync'));
    console.log('Pending Sync:', localStorage.getItem('pendingSync'));
    console.log('========== END DEBUG INFO ==========');
  }

  static async bootstrap() {
    const loadedFromCloud = await this.pullAll();
    if (!loadedFromCloud) {
      await this.pushAll();
    }
    return loadedFromCloud;
  }

  static queuePush() {
    // Debounced push with exponential backoff and in-progress guard
    if (!this._pushState) this._pushState = { inProgress: false, retry: 0 };

    if (this._pushState.inProgress) {
      // mark pending and increase retry hint
      this._pushState.retry = Math.min((this._pushState.retry || 0) + 1, 6);
      try { localStorage.setItem('pendingSync', 'true'); } catch (e) {}
      return;
    }

    this._pushState.inProgress = true;
    this._pushState.retry = this._pushState.retry || 0;
    try { localStorage.setItem('pendingSync', 'true'); } catch (e) {}

    const attempt = async () => {
      try {
        const ok = await this.pushAll();
        if (ok) {
          this._pushState.inProgress = false;
          this._pushState.retry = 0;
          try { localStorage.removeItem('pendingSync'); } catch (e) {}
          return;
        }
        throw new Error('pushAll returned false');
      } catch (err) {
        console.error('Cloud push failed', err);
        this._pushState.retry = (this._pushState.retry || 0) + 1;
        const delay = Math.min(60000, Math.pow(2, this._pushState.retry) * 1000);
        setTimeout(attempt, delay);
      }
    };

    attempt();
  }
}

window.CloudStore = CloudStore;

// Debug function for user to check Firebase data
window.debugFirebaseData = async function(userId) {
  return CloudStore.debugShowAllData(userId);
};

class Auth {
  static init() {
    const defaultUsers = [
      {
        id: 'admin001',
        username: 'admin',
        password: 'admin123',
        role: 'admin',
        name: 'Admin User',
        level: 'all'
      },
      {
        id: 'teacher001',
        username: 'teacher',
        password: '91191967',
        role: 'teacher',
        name: 'Chen Lao Shi',
        level: 'all'
      }
    ];

    const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
    if (storedUsers.length === 0) {
      localStorage.setItem('users', JSON.stringify(defaultUsers));
    } else {
      let usersChanged = false;
      defaultUsers.forEach(defaultUser => {
        const existingUser = storedUsers.find(user => user.username === defaultUser.username);
        if (existingUser) {
          if (
            existingUser.password !== defaultUser.password ||
            existingUser.name !== defaultUser.name ||
            existingUser.role !== defaultUser.role ||
            existingUser.level !== defaultUser.level
          ) {
            existingUser.password = defaultUser.password;
            existingUser.name = defaultUser.name;
            existingUser.role = defaultUser.role;
            existingUser.level = defaultUser.level;
            usersChanged = true;
          }
        } else {
          storedUsers.push(defaultUser);
          usersChanged = true;
        }
      });

      if (usersChanged) {
        localStorage.setItem('users', JSON.stringify(storedUsers));
      }
    }

    // Initialize student wallets if not exist
    if (!localStorage.getItem('wallets')) {
      localStorage.setItem('wallets', JSON.stringify({}));
    }

    // Initialize student progress if not exist
    if (!localStorage.getItem('progress')) {
      localStorage.setItem('progress', JSON.stringify({}));
    }
  }

  static login(username, password) {
    const nextUsername = String(username).trim();
    const nextPassword = String(password);
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => String(u.username) === nextUsername && String(u.password) === nextPassword);

    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      return { success: true, user };
    }
    return { success: false, error: 'Invalid username or password' };
  }

  static async loginAsync(username, password) {
    try {
      const apiReady = await CloudStore.waitForFirebaseApi();
      if (!apiReady) {
        return { success: false, error: 'Firebase is still loading. Please refresh and try again.' };
      }

      await window.firebaseInit();
      const usersLoaded = await window.CloudStore.pullUsersOnly();
      if (!usersLoaded) {
        return { success: false, error: 'No users found in Firebase.' };
      }

      const result = this.login(username, password);
      if (result.success) {
        await window.CloudStore.pullAll();
        return result;
      }

      return result;
    } catch (error) {
      console.error('Cloud login sync failed', error);
      return {
        success: false,
        error: 'Unable to load Firebase data. Check Firestore rules and network access.'
      };
    }

    return { success: false, error: 'Firebase login failed' };
  }

  static getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
  }

  static logout() {
    localStorage.removeItem('currentUser');
  }

  static signup(username, password, name, level) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');

    // Check if username exists
    if (users.find(u => u.username === username)) {
      return { success: false, error: 'Username already exists' };
    }

    const newStudent = {
      id: 'student_' + Date.now(),
      username,
      password,
      role: 'student',
      name,
      level
    };

    users.push(newStudent);
    localStorage.setItem('users', JSON.stringify(users));
    CloudStore.queuePush();

    // Initialize wallet for new student
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    wallets[newStudent.id] = { balance: 0, history: [] };
    localStorage.setItem('wallets', JSON.stringify(wallets));

    // Initialize progress for new student
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    progress[newStudent.id] = [];
    localStorage.setItem('progress', JSON.stringify(progress));
    CloudStore.queuePush();

    return { success: true, user: newStudent };
  }

  static assignLevel(studentId, level, adminId) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.id === studentId);

    if (user && user.role === 'student') {
      user.level = level;
      localStorage.setItem('users', JSON.stringify(users));
      CloudStore.queuePush();
      return { success: true };
    }
    return { success: false, error: 'Student not found' };
  }

  static updateStudent(studentId, updates) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.id === studentId && u.role === 'student');

    if (!user) {
      return { success: false, error: 'Student not found' };
    }

    const nextName = (updates.name || '').trim();
    const nextUsername = (updates.username || '').trim();
    const nextPassword = (updates.password || '').trim();
    const nextLevel = (updates.level || '').trim();

    if (!nextName) {
      return { success: false, error: 'Name is required' };
    }

    if (!nextUsername) {
      return { success: false, error: 'Username is required' };
    }

    const usernameExists = users.some(existingUser => existingUser.username === nextUsername && existingUser.id !== studentId);
    if (usernameExists) {
      return { success: false, error: 'Username already exists' };
    }

    user.name = nextName;
    user.username = nextUsername;
    if (nextPassword) {
      user.password = nextPassword;
    }
    if (nextLevel) {
      user.level = nextLevel;
    }

    localStorage.setItem('users', JSON.stringify(users));
    CloudStore.queuePush();

    const currentUser = Auth.getCurrentUser();
    if (currentUser && currentUser.id === studentId) {
      localStorage.setItem('currentUser', JSON.stringify(user));
    }

    return { success: true, user };
  }

  static deleteStudent(studentId) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const userIndex = users.findIndex(u => u.id === studentId && u.role === 'student');

    if (userIndex === -1) {
      return { success: false, error: 'Student not found' };
    }

    users.splice(userIndex, 1);
    localStorage.setItem('users', JSON.stringify(users));

    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    delete wallets[studentId];
    localStorage.setItem('wallets', JSON.stringify(wallets));

    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    delete progress[studentId];
    localStorage.setItem('progress', JSON.stringify(progress));
    CloudStore.queuePush();

    const currentUser = Auth.getCurrentUser();
    if (currentUser && currentUser.id === studentId) {
      Auth.logout();
    }

    return { success: true };
  }

  static getStudents() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    return users.filter(u => u.role === 'student');
  }

  static getAllUsers() {
    return JSON.parse(localStorage.getItem('users') || '[]');
  }
}

// Wallet Management
class Wallet {
  static getBalance(userId) {
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    return wallets[userId]?.balance || 0;
  }

  static addPoints(userId, points, reason) {
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    if (!wallets[userId]) wallets[userId] = { balance: 0, history: [] };

    wallets[userId].balance += points;
    wallets[userId].history.push({
      date: new Date().toISOString(),
      type: 'credit',
      points,
      reason
    });

    localStorage.setItem('wallets', JSON.stringify(wallets));
    CloudStore.queuePush();
    return wallets[userId];
  }

  static deductPoints(userId, points, reason) {
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    if (!wallets[userId]) wallets[userId] = { balance: 0, history: [] };

    if (wallets[userId].balance < points) {
      return { success: false, error: 'Insufficient points' };
    }

    wallets[userId].balance -= points;
    wallets[userId].history.push({
      date: new Date().toISOString(),
      type: 'debit',
      points,
      reason
    });

    localStorage.setItem('wallets', JSON.stringify(wallets));
    CloudStore.queuePush();
    return { success: true, balance: wallets[userId].balance };
  }

  static getHistory(userId) {
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    return wallets[userId]?.history || [];
  }
}

// Progress & Score Tracking
class Progress {
  static recordQuizScore(userId, quizId, score, timeSpent) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    if (!progress[userId]) progress[userId] = [];

    progress[userId].push({
      type: 'quiz',
      id: quizId,
      score,
      timeSpent,
      date: new Date().toISOString()
    });

    localStorage.setItem('progress', JSON.stringify(progress));
    CloudStore.queuePush();
    return true;
  }

  static recordGameScore(userId, gameId, score, timeSpent) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    if (!progress[userId]) progress[userId] = [];

    const normalizedScore = typeof score === 'number' && !Number.isNaN(score) ? score : Number(score);

    progress[userId].push({
      type: 'game',
      id: gameId,
      score: Number.isFinite(normalizedScore) ? normalizedScore : 0,
      timeSpent,
      date: new Date().toISOString()
    });

    localStorage.setItem('progress', JSON.stringify(progress));
    CloudStore.queuePush();
    return true;
  }

  static recordPracticeCompletion(userId, practiceKind, title, level) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    if (!progress[userId]) progress[userId] = [];

    const record = {
      id: 'practice_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type: 'practice',
      practiceKind,
      title,
      level,
      points: 1,
      claimed: false,
      date: new Date().toISOString()
    };

    progress[userId].push(record);
    localStorage.setItem('progress', JSON.stringify(progress));
    CloudStore.queuePush();
    return record;
  }

  static async recordPracticeAttempt(userId, practiceKind, title, level) {
    console.log('[recordPracticeAttempt] Called for userId:', userId, 'practiceKind:', practiceKind, 'title:', title);
    
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    if (!progress[userId]) progress[userId] = [];

    const record = {
      id: 'attempt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      type: 'attempt',
      practiceKind,
      title,
      level,
      date: new Date().toISOString()
    };

    progress[userId].push(record);
    localStorage.setItem('progress', JSON.stringify(progress));
    console.log('[recordPracticeAttempt] Saved to localStorage. Total records for user:', progress[userId].length);
    
    // Await immediate push to ensure record reaches cloud before continuing
    try {
      console.log('[recordPracticeAttempt] Calling pushAll()...');
      const pushAllOk = await CloudStore.pushAll();
      console.log('[recordPracticeAttempt] pushAll() returned:', pushAllOk);
      
      // Also push to dedicated listeningHistory collection for explicit tracking
      console.log('[recordPracticeAttempt] Calling pushListeningRecord()...');
      const listeningOk = await CloudStore.pushListeningRecord(userId, practiceKind, title, level);
      console.log('[recordPracticeAttempt] pushListeningRecord() returned:', listeningOk);
    } catch (e) {
      console.error('[recordPracticeAttempt] ERROR during push:', e);
      // Fall back to queue in case of immediate push failure
      console.log('[recordPracticeAttempt] Falling back to queuePush()');
      CloudStore.queuePush();
    }
    return record;
  }

  static async claimPracticeReward(userId, rewardId) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    const records = progress[userId] || [];
    const record = records.find(item => item.id === rewardId && item.type === 'practice');

    if (!record) {
      return { success: false, error: 'Practice reward not found' };
    }

    if (record.claimed) {
      return { success: false, error: 'Reward already claimed' };
    }

    record.claimed = true;
    record.claimedAt = new Date().toISOString();
    localStorage.setItem('progress', JSON.stringify(progress));
    // Await immediate push to ensure reward claim syncs to cloud
    try {
      await CloudStore.pushAll();
    } catch (e) {
      console.error('Failed to push reward claim:', e);
      CloudStore.queuePush();
    }
    return { success: true, points: record.points || 1, record };
  }

  static getStudentProgress(userId) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    return progress[userId] || [];
  }

  static getStudentPracticeHistory(userId) {
    const practiceRecords = Progress.getStudentProgress(userId)
      .filter(record => record.type === 'practice')
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const grouped = new Map();

    practiceRecords.forEach(record => {
      const groupKey = `${record.practiceKind}::${record.title}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          practiceKind: record.practiceKind,
          title: record.title,
          level: record.level,
          count: 0,
          lastPlayedAt: record.date,
          records: []
        });
      }

      const item = grouped.get(groupKey);
      item.count += 1;
      item.records.push(record);
      if (new Date(record.date) > new Date(item.lastPlayedAt)) {
        item.lastPlayedAt = record.date;
      }
    });

    return {
      rawRecords: practiceRecords,
      groupedRecords: Array.from(grouped.values()).sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
    };
  }

  static async getListeningCountFromFirebase(userId) {
    // Retrieve total listening count from Firebase listeningHistory collection
    const count = await CloudStore.getListeningCount(userId);
    return count;
  }

  static getStudentAttempts(userId) {
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    const attempts = (progress[userId] || []).filter(r => r.type === 'attempt')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return attempts;
  }

  static getStudentStats(userId) {
    const progressList = Progress.getStudentProgress(userId);
    const quizzes = progressList.filter(p => p.type === 'quiz');
    const games = progressList.filter(p => p.type === 'game');

    return {
      totalQuizzes: quizzes.length,
      averageQuizScore: quizzes.length ? (quizzes.reduce((sum, q) => sum + q.score, 0) / quizzes.length).toFixed(1) : 0,
      totalGames: games.length,
      averageGameScore: games.length ? (games.reduce((sum, g) => sum + g.score, 0) / games.length).toFixed(1) : 0,
      totalTimeSpent: progressList.reduce((sum, p) => sum + (p.timeSpent || 0), 0),
      recentActivities: progressList.slice(-5).reverse()
    };
  }

  static getAllStudentActivities() {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    const activities = [];

    Object.keys(progress).forEach(userId => {
      const student = users.find(u => u.id === userId);
      if (student) {
        progress[userId].forEach(record => {
          if (record.type === 'practice') {
            activities.push({
              studentName: student.name,
              studentId: userId,
              activityType: record.practiceKind === 'passage' ? 'Passage Practice' : 'Spelling Practice',
              title: record.title,
              level: record.level,
              points: record.points || 1,
              claimed: !!record.claimed,
              date: record.date
            });
            return;
          }

          if (record.type === 'attempt') {
            activities.push({
              studentName: student.name,
              studentId: userId,
              activityType: record.practiceKind === 'passage' ? 'Passage Attempt' : 'Spelling Attempt',
              title: record.title,
              level: record.level,
              date: record.date,
              isAttempt: true
            });
            return;
          }

          activities.push({
            studentName: student.name,
            studentId: userId,
            activityType: record.type === 'quiz' ? 'Quiz' : 'Game',
            score: record.score != null ? record.score : 0,
            date: record.date
          });
        });
      }
    });

    return activities.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
  }
}

// Initialize on load
Auth.init();
