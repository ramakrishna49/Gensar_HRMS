const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '../data/gensar_hrms.db'));

db.pragma('journal_mode = WAL');

console.log('Adding checkout photo support...');

const attendanceCols = db.prepare('PRAGMA table_info(attendance)').all().map(c => c.name);
if (!attendanceCols.includes('photo_token_checkout')) {
    db.prepare('ALTER TABLE attendance ADD COLUMN photo_token_checkout TEXT').run();
    console.log('  Added column: attendance.photo_token_checkout');
} else {
    console.log('  Column exists: attendance.photo_token_checkout');
}

const photoCols = db.prepare('PRAGMA table_info(attendance_photos)').all().map(c => c.name);
if (!photoCols.includes('type')) {
    db.prepare("ALTER TABLE attendance_photos ADD COLUMN type TEXT NOT NULL DEFAULT 'check_in'").run();
    console.log('  Added column: attendance_photos.type');
} else {
    console.log('  Column exists: attendance_photos.type');
}

console.log('Migration complete.');
db.close();
