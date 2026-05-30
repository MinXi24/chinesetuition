// Authentication & User Management with localStorage

class Auth {
  static init() {
    // Initialize default admin if no users exist
    if (!localStorage.getItem('users')) {
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
      localStorage.setItem('users', JSON.stringify(defaultUsers));
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

    // Initialize wallet for new student
    const wallets = JSON.parse(localStorage.getItem('wallets') || '{}');
    wallets[newStudent.id] = { balance: 0, history: [] };
    localStorage.setItem('wallets', JSON.stringify(wallets));

    // Initialize progress for new student
    const progress = JSON.parse(localStorage.getItem('progress') || '{}');
    progress[newStudent.id] = [];
    localStorage.setItem('progress', JSON.stringify(progress));

    return { success: true, user: newStudent };
  }

  static assignLevel(studentId, level, adminId) {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const user = users.find(u => u.id === studentId);

    if (user && user.role === 'student') {
      user.level = level;
      localStorage.setItem('users', JSON.stringify(users));
      return { success: true };
    }
    return { success: false, error: 'Student not found' };
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
      points: 4,
      claimed: false,
      date: new Date().toISOString()
    };

    progress[userId].push(record);
    localStorage.setItem('progress', JSON.stringify(progress));
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
    return { success: true, points: record.points || 4, record };
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
              points: record.points || 4,
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
