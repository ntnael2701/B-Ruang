const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'b-ruang.db');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'b-ruang-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 }
}));

function ensureLoggedIn(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

function ensureRole(role) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.role === role) return next();
    res.redirect('/login');
  };
}

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      name TEXT,
      password TEXT,
      role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      area TEXT,
      capacity INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT,
      user_email TEXT,
      room_id INTEGER,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      purpose TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )`);

    const seedUsers = [
      { email: 'mahasiswa@undip.ac.id', name: 'Mahasiswa Undip', password: 'mahasiswa123', role: 'mahasiswa' },
      { email: 'admin@undip.ac.id', name: 'Admin B-Ruang', password: 'admin123', role: 'admin' }
    ];

    const seedRooms = [
      { name: 'Ruang Seminar A', area: '60 m²', capacity: 40 },
      { name: 'Ruang Kelas B', area: '45 m²', capacity: 30 },
      { name: 'Ruang Rapat C', area: '30 m²', capacity: 20 }
    ];

    seedUsers.forEach(user => {
      db.run(`INSERT OR IGNORE INTO users (email, name, password, role) VALUES (?, ?, ?, ?)`,
        [user.email, user.name, user.password, user.role]);
    });

    seedRooms.forEach(room => {
      db.run(`INSERT OR IGNORE INTO rooms (name, area, capacity) VALUES (?, ?, ?)`,
        [room.name, room.area, room.capacity]);
    });
  });
}

initDatabase();

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/student');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password, role } = req.body;
  db.get(`SELECT * FROM users WHERE email = ? AND role = ?`, [email, role], (err, user) => {
    if (err) return res.render('login', { error: 'Terjadi kesalahan server.' });
    if (!user || user.password !== password) {
      return res.render('login', { error: 'Email, password, atau role salah.' });
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    return res.redirect(user.role === 'admin' ? '/admin' : '/student');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/student', ensureLoggedIn, ensureRole('mahasiswa'), (req, res) => {
  db.all(`SELECT * FROM rooms`, [], (err, rooms) => {
    if (err) return res.send('Gagal memuat ruangan.');
    db.all(`SELECT b.id, b.date, b.start_time, b.end_time, b.purpose, b.status, r.name AS room_name
            FROM bookings b
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE b.user_email = ?
            ORDER BY b.created_at DESC`, [req.session.user.email], (err2, bookings) => {
      if (err2) return res.send('Gagal memuat pemesanan.');
      res.render('student', { user: req.session.user, rooms, bookings });
    });
  });
});

app.post('/book', ensureLoggedIn, ensureRole('mahasiswa'), (req, res) => {
  const { room_id, date, start_time, end_time, purpose } = req.body;
  const userName = req.session.user.name;
  const userEmail = req.session.user.email;

  db.run(`INSERT INTO bookings (user_name, user_email, room_id, date, start_time, end_time, purpose, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
    [userName, userEmail, room_id, date, start_time, end_time, purpose], function (err) {
      if (err) return res.send('Gagal membuat permintaan booking.');
      res.redirect('/student');
    });
});

app.get('/admin', ensureLoggedIn, ensureRole('admin'), (req, res) => {
  db.all(`SELECT b.id, b.user_name, b.user_email, b.date, b.start_time, b.end_time, b.purpose, b.status, r.name AS room_name, r.area, r.capacity
          FROM bookings b
          LEFT JOIN rooms r ON b.room_id = r.id
          ORDER BY b.created_at DESC`, [], (err, bookings) => {
    if (err) return res.send('Gagal memuat permintaan booking.');
    res.render('admin', { user: req.session.user, bookings });
  });
});

app.post('/admin/decision', ensureLoggedIn, ensureRole('admin'), (req, res) => {
  const { booking_id, action } = req.body;
  const status = action === 'approve' ? 'Approved' : 'Rejected';
  db.run(`UPDATE bookings SET status = ? WHERE id = ?`, [status, booking_id], function (err) {
    if (err) return res.send('Gagal memperbarui status booking.');
    res.redirect('/admin');
  });
});

app.listen(PORT, () => {
  console.log(`B-Ruang berjalan di http://localhost:${PORT}`);
});
