# 🌟 Chinese Tuition Platform - Complete Setup Guide

## 📚 What You Have
A complete web-based Chinese tutoring platform with:
- ✅ **Authentication** - Student signup/login with role-based access
- ✅ **Student Dashboard** - E-Wallet, progress tracking
- ✅ **Flashcards** - Chinese characters with stroke order visualization  
- ✅ **Quizzes** - Multiple choice quizzes with point earning
- ✅ **Teacher Dashboard** - Student progress monitoring & wallet management
- ✅ **Reading Helper** - Your existing ting xie/passage reader
- 📋 **Placeholder modules** - Games, Ting Xie, Passages (ready to expand)

## 🚀 Quick Start

### 1. **Open the Platform**
   - Open `login.html` in your browser
   - This is your entry point for ALL users

### 2. **Demo Accounts** (Already set up)
   ```
   👨‍🎓 Student:
   - Username: student
   - Password: pass123
   - Level: P5 (you can change in teacher dashboard)
   
   👨‍🏫 Teacher:
   - Username: teacher
   - Password: teacher123
   
   🔐 Admin:
   - Username: admin
   - Password: admin123
   ```

### 3. **Test the System**
   
   **As a Student:**
   1. Login with `student / pass123`
   2. View your E-Wallet (starts at 0 points)
   3. Go to Quizzes → Start Quiz → Complete it
   4. ✨ Points are automatically added to your wallet!
   5. View wallet history

   **As a Teacher:**
   1. Login with `teacher / teacher123`
   2. See all students, their scores, and progress
   3. Click "👁️ View" to see detailed student progress
   4. "💸 Deduct Points" to redeem points for students
   5. "📋 Assign Levels" to set student access levels

---

## 📁 File Structure
```
chinesetuition/
├── login.html                 ← START HERE
├── auth.js                    ← All auth & wallet logic
├── dashboard-student.html     ← Student home
├── dashboard-teacher.html     ← Teacher/Admin home
├── flashcards.html            ← Study mode
├── quiz.html                  ← Quiz & earn points
├── games.html                 ← (Placeholder)
├── tingxie.html               ← (Placeholder)
├── passages.html              ← (Placeholder)
├── index.html                 ← Your reading helper
├── app.js                     ← Reading helper logic
└── config.json                ← Reading passages config
```

---

## 💾 Data Storage (All in Browser)
Everything is stored in **localStorage** - no server needed:
- **Users** - Student accounts, passwords, roles, levels
- **Wallets** - Point balance & transaction history
- **Progress** - Quiz scores, game scores, timestamps
- **All data persists** until browser cache is cleared

### View/Clear Data (for testing):
In browser console (F12):
```javascript
// View all users
JSON.parse(localStorage.getItem('users'))

// View student wallets
JSON.parse(localStorage.getItem('wallets'))

// View student progress
JSON.parse(localStorage.getItem('progress'))

// Clear everything (fresh start)
localStorage.clear()
```

---

## 🎓 How It Works

### Student Flow
1. **Signup/Login** → Access dashboard based on level
2. **Study** → Flashcards (stroke order), Quizzes, Games
3. **Earn Points** → Complete quizzes (50%+ pass = points)
4. **Track Progress** → See all quizzes, scores, time spent
5. **Use Wallet** → Teacher redeems points in class

### Teacher Flow
1. **Login** → See all students
2. **Monitor** → View progress, scores, time spent
3. **Manage** → Assign levels, deduct points
4. **Redeem** → Click "💸 Deduct" to claim points for students

### Admin Flow
- Same as teacher (full access to all levels)

---

## 📊 Features Breakdown

### 🎴 Flashcards
- **Stroke Order** - Canvas-based visualization
- **Multiple Levels** - P1-P6 content
- **3D Flip Animation** - Front: character, Back: meaning + pinyin
- Sample data included (easy to expand)

### 📝 Quizzes
- **Multiple Choice** - With instant feedback
- **Point System** - 70%+ = full points, 50-69% = half points
- **Timer** - Tracks time spent
- **Sample Quizzes** - 2 per level (customize in `quiz.html`)

### 💳 Wallet System
- **Earn** - Automatically on quiz completion
- **Deduct** - Teacher/Admin redeem for physical rewards
- **History** - Full transaction log (date, type, amount, reason)
- **Balance** - Always visible to students

### 📊 Progress Tracking
- **Quiz Stats** - Count, average scores
- **Game Stats** - Count, average scores
- **Time Tracking** - Total minutes spent
- **Recent Activities** - Last 5 actions

---

## ⚙️ Customization

### Add More Quiz Questions
Edit `quiz.html`, find the `quizData` object:
```javascript
'P1': [
    {
        id: 'p1_quiz_1',
        title: 'Numbers 1-10',
        points: 10,
        questions: [
            { question: 'What is 一?', options: ['One', 'Two', 'Three'], correct: 0 },
            // Add more...
        ]
    }
]
```

### Add Flashcard Words
Edit `flashcards.html`, modify `flashcardData`:
```javascript
'P1': [
    { 
        word: '一', 
        meaning: 'One', 
        pinyin: 'yī', 
        strokes: [[50,150,250,150]]  // Line coordinates
    }
]
```

### Customize Point Values
- In `quiz.html` - Change `quiz.points` for each quiz
- In `flashcards.html` - Add points for studying
- In `games.html` - Set points per game

### Add New Student Levels
Edit `auth.js` - Expand level options in signup

---

## 🔄 Next Steps (When Ready for Firebase)

When you want cross-device sync:
1. Create Firebase project (free)
2. Import `firebase.js` library
3. Modify `auth.js` to sync with Firebase Realtime Database
4. Same app structure, just cloud-backed data

**No changes needed to UI!** Just swap the storage backend.

---

## ⚠️ Important Notes

### Limitations (localStorage only)
- ❌ Data only syncs on same browser/device
- ❌ Data lost if browser cache cleared
- ❌ Can't share data between student's phone and laptop (yet)

### For Production
- Add server/database (Firebase, Node.js, etc.)
- Add SSL/HTTPS
- Add input validation
- Add more security checks

### Browser Requirements
- Any modern browser (Chrome, Firefox, Safari, Edge)
- JavaScript enabled
- ~5MB storage per domain

---

## 🐛 Troubleshooting

**Q: Login not working?**
- Clear browser cache & reload
- Check demo credentials above
- In console: `JSON.parse(localStorage.getItem('users'))`

**Q: No points after quiz?**
- Score must be ≥50%
- Check wallet: `JSON.parse(localStorage.getItem('wallets'))`

**Q: Student can't access higher level content?**
- Teacher must assign level first
- Check user level: `Auth.getStudents()`

**Q: Can't see my progress?**
- Must complete at least 1 quiz/game first
- Progress saves automatically

---

## 📞 Support
For issues, check:
1. Browser console (F12) for errors
2. localStorage data (see above)
3. User role & level assignment
4. Quiz completion status

---

**Made with ❤️ for Chinese tutoring**
