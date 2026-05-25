const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'b-ruang.db');
const uploadFolder = path.join(__dirname, 'public', 'files', 'surat');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(uploadFolder, { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadFolder),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.pdf', '.doc', '.docx'];
    const allowedMime = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext)) {
      return cb(null, true);
    }
    cb(new Error('Hanya file PDF, DOC, atau DOCX yang diperbolehkan.'));
  }
});

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

function renderStudentPage(req, res, error = null) {
  db.all(`SELECT * FROM rooms`, [], (err, rooms) => {
    if (err) return res.send('Gagal memuat ruangan.');
    db.all(`SELECT b.id, b.date, b.start_time, b.end_time, b.purpose, b.status, b.letter_file, r.name AS room_name
            FROM bookings b
            LEFT JOIN rooms r ON b.room_id = r.id
            WHERE b.user_email = ?
            ORDER BY b.created_at DESC`, [req.session.user.email], (err2, bookings) => {
      if (err2) return res.send('Gagal memuat pemesanan.');
      db.run(`UPDATE notifications SET status = 'Read' WHERE user_email = ? AND status = 'Unread'`, [req.session.user.email], () => {
        db.all(`SELECT id, booking_id, message, status, created_at
                FROM notifications
                WHERE user_email = ?
                ORDER BY created_at DESC`, [req.session.user.email], (err3, notifications) => {
          if (err3) return res.send('Gagal memuat notifikasi.');
          res.render('student', { user: req.session.user, rooms, bookings, notifications, error });
        });
      });
    });
  });
}

function initDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      name TEXT,
      password TEXT,
      role TEXT,
      nim TEXT,
      prodi TEXT,
      angkatan TEXT
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
      letter_file TEXT,
      status TEXT DEFAULT 'Pending',
      hod_status TEXT DEFAULT 'Pending',
      dean_status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(room_id) REFERENCES rooms(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
      booking_id INTEGER,
      message TEXT,
      status TEXT DEFAULT 'Unread',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(booking_id) REFERENCES bookings(id)
    )`);

    const seedUsers = [
      { email: 'mahasiswa@undip.ac.id', name: 'Mahasiswa Undip', password: 'mahasiswa123', role: 'mahasiswa' },
      { email: 'admin@undip.ac.id', name: 'Admin B-Ruang', password: 'admin123', role: 'admin' }
    ];

    const seedRooms = [
      { name: 'Auditorium Soedjono', area: '200 m²', capacity: 300 },
      { name: 'Ruang Kelas 101', area: '55 m²', capacity: 40 },
      { name: 'Ruang Rapat Dekanat', area: '40 m²', capacity: 25 },
      { name: 'Laboratorium Komputer 4', area: '60 m²', capacity: 35 },
      { name: 'Ruang Seminar 2', area: '75 m²', capacity: 60 }
    ];

    seedUsers.forEach(user => {
      db.run(`INSERT OR IGNORE INTO users (email, name, password, role) VALUES (?, ?, ?, ?)`,
        [user.email, user.name, user.password, user.role]);
    });

    seedRooms.forEach(room => {
      db.get(`SELECT id FROM rooms WHERE name = ?`, [room.name], (err, row) => {
        if (err) return;
        if (!row) {
          db.run(`INSERT INTO rooms (name, area, capacity) VALUES (?, ?, ?)`,
            [room.name, room.area, room.capacity]);
        }
      });
    });

    // Update old sample room names to new UDIP room names if already present in the database
    db.run(`UPDATE rooms SET name = ?, area = ?, capacity = ? WHERE name = ?`, ['Auditorium Soedjono', '200 m²', 300, 'Ruang Seminar A']);
    db.run(`UPDATE rooms SET name = ?, area = ?, capacity = ? WHERE name = ?`, ['Ruang Kelas 101', '55 m²', 40, 'Ruang Kelas B']);
    db.run(`UPDATE rooms SET name = ?, area = ?, capacity = ? WHERE name = ?`, ['Ruang Rapat Dekanat', '40 m²', 25, 'Ruang Rapat C']);
  });
}

initDatabase();

// Migrate bookings table to include approval steps if missing
db.all(`PRAGMA table_info(bookings)`, [], (err, cols) => {
  if (err) return console.error(err);
  const names = cols.map(c => c.name);
  if (!names.includes('hod_status')) {
    db.run(`ALTER TABLE bookings ADD COLUMN hod_status TEXT DEFAULT 'Pending'`);
  }
  if (!names.includes('dean_status')) {
    db.run(`ALTER TABLE bookings ADD COLUMN dean_status TEXT DEFAULT 'Pending'`);
  }
  if (!names.includes('letter_file')) {
    db.run(`ALTER TABLE bookings ADD COLUMN letter_file TEXT`);
  }
  if (!names.includes('nim')) {
    db.run(`ALTER TABLE users ADD COLUMN nim TEXT`);
  }
  if (!names.includes('prodi')) {
    db.run(`ALTER TABLE users ADD COLUMN prodi TEXT`);
  }
  if (!names.includes('angkatan')) {
    db.run(`ALTER TABLE users ADD COLUMN angkatan TEXT`);
  }
});

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/student');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

function studentNeedsProfile(user) {
  return !user || !user.nim || !user.prodi || !user.angkatan;
}

app.post('/login', (req, res) => {
  const { email, password, role } = req.body;
  db.get(`SELECT * FROM users WHERE email = ? AND role = ?`, [email, role], (err, user) => {
    if (err) return res.render('login', { error: 'Terjadi kesalahan server.' });
    if (!user || user.password !== password) {
      return res.render('login', { error: 'Email, password, atau role salah.' });
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      nim: user.nim,
      prodi: user.prodi,
      angkatan: user.angkatan
    };
    if (user.role === 'admin') {
      return res.redirect('/admin');
    }
    if (studentNeedsProfile(req.session.user)) {
      return res.redirect('/student/profile');
    }
    return res.redirect('/student');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/student', ensureLoggedIn, ensureRole('mahasiswa'), (req, res) => {
  if (studentNeedsProfile(req.session.user)) {
    return res.redirect('/student/profile');
  }
  renderStudentPage(req, res);
});

app.get('/student/profile', ensureLoggedIn, ensureRole('mahasiswa'), (req, res) => {
  if (!studentNeedsProfile(req.session.user)) {
    return res.redirect('/student');
  }
  res.render('student_profile', { user: req.session.user, error: null });
});

app.post('/student/profile', ensureLoggedIn, ensureRole('mahasiswa'), (req, res) => {
  const { name, nim, prodi, angkatan } = req.body;
  if (!name || !nim || !prodi || !angkatan) {
    return res.render('student_profile', { user: req.session.user, error: 'Mohon lengkapi semua data identitas.' });
  }
  db.run(`UPDATE users SET name = ?, nim = ?, prodi = ?, angkatan = ? WHERE id = ?`,
    [name, nim, prodi, angkatan, req.session.user.id], function (err) {
      if (err) {
        console.error('Update profile error:', err);
        return res.render('student_profile', { user: req.session.user, error: 'Gagal menyimpan data identitas. Silakan coba lagi.' });
      }
      req.session.user = {
        ...req.session.user,
        name,
        nim,
        prodi,
        angkatan
      };
      res.redirect('/student');
    });
});

app.post('/book', ensureLoggedIn, ensureRole('mahasiswa'), (req, res, next) => {
  upload.single('letter_pdf')(req, res, function (err) {
    if (err) {
      return renderStudentPage(req, res, err.message || 'Terjadi kesalahan saat mengunggah surat. Pastikan file PDF.');
    }
    next();
  });
}, (req, res) => {
  const { room_id, date, start_time, end_time, purpose } = req.body;
  const userName = req.session.user.name;
  const userEmail = req.session.user.email;
  const letterFile = req.file && req.file.filename;

  if (!room_id || !date || !start_time || !end_time || !purpose) {
    return renderStudentPage(req, res, 'Mohon isi semua field sebelum mengirim permintaan booking.');
  }

  if (!letterFile) {
    return renderStudentPage(req, res, 'Mohon unggah surat PDF sebelum mengirim permintaan booking.');
  }

  if (start_time >= end_time) {
    return renderStudentPage(req, res, 'Jam selesai harus lebih besar dari jam mulai.');
  }

  db.run(`INSERT INTO bookings (user_name, user_email, room_id, date, start_time, end_time, purpose, letter_file, status, hod_status, dean_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Awaiting HOD', 'Pending', 'Pending')`,
    [userName, userEmail, room_id, date, start_time, end_time, purpose, letterFile], function (err) {
      if (err) {
        console.error('Booking error:', err);
        return renderStudentPage(req, res, 'Gagal membuat permintaan booking. Silakan coba lagi.');
      }
      res.redirect('/student');
    });
});

app.get('/admin', ensureLoggedIn, ensureRole('admin'), (req, res) => {
  db.all(`SELECT b.id, b.user_name, b.user_email, b.date, b.start_time, b.end_time, b.purpose, b.status, r.name AS room_name, r.area, r.capacity, b.letter_file
          , b.hod_status, b.dean_status
          FROM bookings b
          LEFT JOIN rooms r ON b.room_id = r.id
          ORDER BY b.created_at DESC`, [], (err, bookings) => {
    if (err) return res.send('Gagal memuat permintaan booking.');
    res.render('admin', { user: req.session.user, bookings });
  });
});

app.get('/map', ensureLoggedIn, (req, res) => {
  // show whether rooms have approved bookings today, with booking times
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  db.all(`SELECT r.id, r.name, r.area, r.capacity,
          (SELECT COUNT(1) FROM bookings b WHERE b.room_id = r.id AND b.status = 'Approved' AND b.date = ?) AS booked_today
          FROM rooms r`, [today], (err, rooms) => {
    if (err) return res.send('Gagal memuat peta ruangan.');
    
    // get all approved bookings for today grouped by room
    db.all(`SELECT b.room_id, b.start_time, b.end_time, b.user_name, b.purpose
            FROM bookings b
            WHERE b.status = 'Approved' AND b.date = ?
            ORDER BY b.room_id, b.start_time`, [today], (err2, bookings) => {
      if (err2) return res.send('Gagal memuat booking.');
      
      // group bookings by room_id
      const bookingsByRoom = {};
      bookings.forEach(b => {
        if (!bookingsByRoom[b.room_id]) bookingsByRoom[b.room_id] = [];
        bookingsByRoom[b.room_id].push({
          start_time: b.start_time,
          end_time: b.end_time,
          user_name: b.user_name,
          purpose: b.purpose
        });
      });

      // simple hardcoded coordinates for rooms (centered on Universitas Diponegoro area)
      const center = [-6.9685, 110.4095];
      const coordsMap = {
        'Auditorium Soedjono': [-6.9704, 110.4090],
        'Ruang Kelas 101': [-6.9695, 110.4088],
        'Ruang Rapat Dekanat': [-6.9689, 110.4103],
        'Laboratorium Komputer 4': [-6.9686, 110.4099],
        'Ruang Seminar 2': [-6.9693, 110.4094]
      };

      const roomsWithCoords = rooms.map(r => ({
        ...r,
        coords: coordsMap[r.name] || center,
        bookings: bookingsByRoom[r.id] || []
      }));

      res.render('map', { user: req.session.user, rooms: roomsWithCoords, center, selectedDate });
    });
  });
});

app.get('/download-template', ensureLoggedIn, (req, res) => {
  const filePath = path.join(__dirname, 'public', 'files', 'template_surat.doc');
  res.download(filePath, 'template_surat.doc');
});

// Serve uploaded letter file inline (so browser can open in same tab)
app.get('/download-surat/:id', (req, res) => {
  const bookingId = req.params.id;

  if (!req.session || !req.session.user) {
    return res.status(401).send('<p>Anda harus <a href="/login">login</a> untuk melihat surat.</p>');
  }

  // Only allow admin or the user who uploaded the letter to view it
  db.get(`SELECT letter_file, user_email FROM bookings WHERE id = ?`, [bookingId], (err, row) => {
    if (err) return res.status(500).send('Terjadi kesalahan server.');
    if (!row || !row.letter_file) return res.status(404).send('Surat tidak ditemukan.');

    const user = req.session.user;
    if (user.role !== 'admin' && user.email !== row.user_email) {
      return res.status(403).send('Anda tidak memiliki akses untuk melihat surat ini.');
    }

    const filePath = path.resolve(uploadFolder, row.letter_file);
    fs.access(filePath, fs.constants.R_OK, (accessErr) => {
      if (accessErr) return res.status(404).send('File surat tidak tersedia.');
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${row.letter_file}"`);
      res.sendFile(filePath, (sendErr) => {
        if (sendErr) {
          console.error('sendFile error:', sendErr);
          if (!res.headersSent) res.status(500).send('Gagal mengirim file surat.');
        }
      });
    });
  });
});

app.get('/template', ensureLoggedIn, (req, res) => {
  // render preview of the letter template (HTML styled for printing/PDF)
  res.render('template', { user: req.session.user });
});

app.post('/admin/decision', ensureLoggedIn, ensureRole('admin'), (req, res) => {
  const { booking_id, action } = req.body;

  function sendNotification(message) {
    db.get(`SELECT user_email FROM bookings WHERE id = ?`, [booking_id], (err, row) => {
      if (!err && row) {
        db.run(`INSERT INTO notifications (user_email, booking_id, message) VALUES (?, ?, ?)`, [row.user_email, booking_id, message]);
      }
    });
  }

  if (action === 'approve') {
    db.run(`UPDATE bookings SET hod_status = 'Approved', status = 'Awaiting Dean' WHERE id = ?`, [booking_id], function (err) {
      if (err) return res.send('Gagal memperbarui status booking.');
      sendNotification('Pengajuan Anda disetujui oleh HOD dan sedang menunggu keputusan Dekanat.');
      res.redirect('/admin');
    });
  } else if (action === 'reject') {
    db.run(`UPDATE bookings SET hod_status = 'Rejected', status = 'Rejected' WHERE id = ?`, [booking_id], function (err) {
      if (err) return res.send('Gagal memperbarui status booking.');
      sendNotification('Pengajuan Anda ditolak oleh HOD.');
      res.redirect('/admin');
    });
  } else if (action === 'dean_approve') {
    db.run(`UPDATE bookings SET dean_status = 'Approved', status = 'Approved' WHERE id = ?`, [booking_id], function (err) {
      if (err) return res.send('Gagal memperbarui status booking.');
      sendNotification('Pengajuan Anda disetujui oleh Dekanat.');
      res.redirect('/admin');
    });
  } else if (action === 'dean_reject') {
    db.run(`UPDATE bookings SET dean_status = 'Rejected', status = 'Rejected' WHERE id = ?`, [booking_id], function (err) {
      if (err) return res.send('Gagal memperbarui status booking.');
      sendNotification('Pengajuan Anda ditolak oleh Dekanat.');
      res.redirect('/admin');
    });
  } else {
    res.redirect('/admin');
  }
});

// Delete booking route
app.post('/admin/delete', ensureLoggedIn, ensureRole('admin'), (req, res) => {
  const { booking_id } = req.body;

  // Get booking details to get the letter file name
  db.get(`SELECT letter_file FROM bookings WHERE id = ?`, [booking_id], (err, row) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).send('Gagal menghapus booking.');
    }
    if (!row) {
      console.log('Booking not found:', booking_id);
      return res.status(404).send('Booking tidak ditemukan.');
    }

    // Delete the file if it exists
    if (row.letter_file) {
      const filePath = path.join(uploadFolder, row.letter_file);
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          console.error('Error deleting file:', unlinkErr);
        }
        // Continue with DB deletion regardless of file deletion
        deleteFromDatabase();
      });
    } else {
      deleteFromDatabase();
    }

    function deleteFromDatabase() {
      // Delete notifications for this booking
      db.run(`DELETE FROM notifications WHERE booking_id = ?`, [booking_id], (notifErr) => {
        if (notifErr) {
          console.error('Error deleting notifications:', notifErr);
          return res.status(500).send('Gagal menghapus notifikasi.');
        }

        // Delete the booking
        db.run(`DELETE FROM bookings WHERE id = ?`, [booking_id], (delErr) => {
          if (delErr) {
            console.error('Error deleting booking:', delErr);
            return res.status(500).send('Gagal menghapus booking dari database.');
          }
          console.log('Booking deleted successfully:', booking_id);
          res.redirect('/admin');
        });
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`B-Ruang berjalan di http://localhost:${PORT}`);
});
