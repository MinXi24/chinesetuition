// Authentication & User Management with localStorage

class CloudStore {
  static async ensureReady() {
    if (!window.firebaseInit || !window.firebaseHelpers) {
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

    const [usersSnap, walletsSnap, progressSnap] = await Promise.all([
      getDocs(collection(fs, 'users')),
      getDocs(collection(fs, 'wallets')),
      getDocs(collection(fs, 'progressRecords'))
    ]);

    if (usersSnap.empty && walletsSnap.empty && progressSnap.empty) {
      return false;
    }

    const users = usersSnap.docs.map(item => {
      const data = item.data();
      return Object.assign({}, data, { id: data.id || item.id });
    });
    const wallets = {};
    walletsSnap.docs.forEach(item => {
      wallets[item.id] = item.data();
    });

    const progress = {};
    progressSnap.docs.forEach(item => {
      const record = item.data();
      if (!record.userId) return;
      if (!progress[record.userId]) progress[record.userId] = [];
      progress[record.userId].push(record);
    });

    Object.keys(progress).forEach(userId => {
      progress[userId].sort((a, b) => new Date(a.date) - new Date(b.date));
    });

    localStorage.setItem('users', JSON.stringify(users));
    localStorage.setItem('wallets', JSON.stringify(wallets));
    localStorage.setItem('progress', JSON.stringify(progress));
    return true;
  }

  static async pushAll() {
    if (!(await this.ensureReady())) {
      return false;
    }

    const { collection, doc, getDocs, setDoc, deleteDoc } = window.firebaseHelpers;
    const fs = window.firestore;
    const state = this.getLocalState();

    const localUserIds = new Set(state.users.map(user => user.id));
    const cloudUsersSnap = await getDocs(collection(fs, 'users'));
    await Promise.all(cloudUsersSnap.docs.map(async item => {
      if (!localUserIds.has(item.id)) {
        await deleteDoc(doc(fs, 'users', item.id));
      }
    }));
    await Promise.all(state.users.filter(user => user.id).map(user => setDoc(doc(fs, 'users', user.id), user)));

    const localWalletIds = new Set(Object.keys(state.wallets));
    const cloudWalletsSnap = await getDocs(collection(fs, 'wallets'));
    await Promise.all(cloudWalletsSnap.docs.map(async item => {
      if (!localWalletIds.has(item.id)) {
        await deleteDoc(doc(fs, 'wallets', item.id));
      }
    }));
    await Promise.all(Object.entries(state.wallets).map(([userId, wallet]) => setDoc(doc(fs, 'wallets', userId), wallet)));

    const localProgressRecords = [];
    Object.entries(state.progress).forEach(([userId, records]) => {
      records.forEach(record => {
        localProgressRecords.push(Object.assign({}, record, { userId }));
      });
    });

    const localProgressIds = new Set(localProgressRecords.map(record => record.id));
    const cloudProgressSnap = await getDocs(collection(fs, 'progressRecords'));
    await Promise.all(cloudProgressSnap.docs.map(async item => {
      if (!localProgressIds.has(item.id)) {
        await deleteDoc(doc(fs, 'progressRecords', item.id));
      }
    }));
    await Promise.all(localProgressRecords.map(record => {
      if (!record.id) {
        record.id = `record_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
      return setDoc(doc(fs, 'progressRecords', record.id), record);
    }));

    return true;
  }

  static async bootstrap() {
    const loadedFromCloud = await this.pullAll();
    if (!loadedFromCloud) {
      await this.pushAll();
    }
    return loadedFromCloud;
  }

  static queuePush() {
    void this.pushAll().catch(error => console.error('Firebase sync failed', error));
  }
}

window.CloudStore = CloudStore;

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
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      return { success: true, user };
    }
    return { success: false, error: 'Invalid username or password' };
  }

  static async loginAsync(username, password) {
    try {
      if (window.firebaseInit && window.firebaseHelpers) {
        await window.firebaseInit();
        const { collection, getDocs, query, where, limit } = window.firebaseHelpers;
        const fs = window.firestore;
        if (fs) {
          const loginQuery = query(
            collection(fs, 'users'),
            where('username', '==', username),
            limit(1)
          );
          const loginSnap = await getDocs(loginQuery);
          if (!loginSnap.empty) {
            const userData = loginSnap.docs[0].data();
            const user = Object.assign({}, userData, { id: userData.id || loginSnap.docs[0].id });
            if (user.password !== password) {
              return { success: false, error: 'Invalid username or password' };
            }
            localStorage.setItem('currentUser', JSON.stringify(user));
            await window.CloudStore.pullAll();
            return { success: true, user };
          }
        }

        await window.CloudStore.pullAll();
      }
    } catch (error) {
      console.error('Cloud login sync failed', error);
      return {
        success: false,
        error: 'Unable to load Firebase data. Check Firestore rules and network access.'
      };
    }

    return this.login(username, password);
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

    progress[userId].push({
      type: 'game',
      id: gameId,
      score,
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

  static claimPracticeReward(userId, rewardId) {
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
    CloudStore.queuePush();
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

          activities.push({
            studentName: student.name,
            studentId: userId,
            activityType: record.type === 'quiz' ? 'Quiz' : 'Game',
            score: record.score,
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
