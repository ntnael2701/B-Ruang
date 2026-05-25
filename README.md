# B-Ruang

Web booking ruangan Undip untuk acara dengan sistem login mahasiswa dan admin.

## Fitur Utama

- Login wajib untuk mahasiswa dan admin
- Mahasiswa mengajukan booking ruangan dengan pilihan jam
- Admin menerima atau menolak permintaan booking
- Menampilkan luas ruangan, kapasitas ruangan, dan status booking
- Tema visual berwarna ungu dan oranye

## Cara Menjalankan

1. Buka terminal di folder proyek ini.
2. Install dependensi:
   ```bash
   npm install
   ```
3. Jalankan aplikasi biasa:
   ```bash
   npm start
   ```
4. Atau jalankan dengan `pm2` agar proses tetap hidup walau terminal ditutup:
   ```bash
   npm run pm2
   ```
5. Buka browser dan akses:
   ```
   http://localhost:3000
   ```

## Mengelola dengan pm2

- Hentikan proses:
  ```bash
  npm run pm2:stop
  ```
- Restart proses:
  ```bash
  npm run pm2:restart
  ```
- Lihat status pm2:
  ```bash
  npm run pm2:list
  ```

## Akun Contoh

- Mahasiswa: `mahasiswa@undip.ac.id` / `mahasiswa123`
- Admin: `admin@undip.ac.id` / `admin123`

## Struktur Proyek

- `server.js` - backend Express + SQLite
- `views/` - halaman EJS untuk login, mahasiswa, dan admin
- `public/css/style.css` - styling tema ungu-oranye
- `data/` - database SQLite otomatis dibuat saat pertama dijalankan
