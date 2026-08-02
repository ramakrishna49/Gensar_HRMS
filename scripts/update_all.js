const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '../data/gensar_hrms.db'));

// 1. Update leave types
db.prepare("UPDATE leave_types SET days_per_year = 12 WHERE name = 'Casual Leave'").run();
db.prepare("UPDATE leave_types SET days_per_year = 12 WHERE name = 'Sick Leave'").run();
db.prepare("UPDATE leave_types SET days_per_year = 0 WHERE name NOT IN ('Casual Leave', 'Sick Leave')").run();
console.log('Leave types updated');

// 2. Add break_start / break_end columns to attendance
try { db.prepare("ALTER TABLE attendance ADD COLUMN break_start TIME").run(); } catch(e) { console.log('break_start column exists'); }
try { db.prepare("ALTER TABLE attendance ADD COLUMN break_end TIME").run(); } catch(e) { console.log('break_end column exists'); }
console.log('Attendance table updated');

const rows = db.prepare('SELECT id, name, days_per_year FROM leave_types ORDER BY id').all();
rows.forEach(r => console.log(`  ${r.id}. ${r.name}: ${r.days_per_year}`));
db.close();
console.log('Done');