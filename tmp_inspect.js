const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("data/b-ruang.db");
db.all("SELECT id, room_id, date, start_time, end_time, status FROM bookings ORDER BY date DESC, start_time DESC", [], (err, rows) => {
  if (err) { console.error(err); process.exit(1); }
  if (!rows.length) { console.log('No bookings found'); process.exit(0); }
  rows.forEach(r => console.log(r.id + '\t' + r.room_id + '\t' + r.date + '\t' + r.start_time + '\t' + r.end_time + '\t' + r.status));
  process.exit(0);
});
