const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, '../data/gensar_hrms.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('Adding new employee detail columns...');
const newColumns = [
    ['permanent_address', 'TEXT'],
    ['languages_spoken', 'TEXT'],
    ['marital_status', 'TEXT'],
    ['personal_email', 'TEXT'],
    ['qualification', 'TEXT'],
    ['specialization', 'TEXT'],
    ['pan_number', 'TEXT'],
    ['aadhaar_number', 'TEXT'],
    ['passport_number', 'TEXT'],
    ['bank_name', 'TEXT'],
    ['bank_branch', 'TEXT'],
    ['bank_account', 'TEXT'],
    ['bank_ifsc', 'TEXT']
];
newColumns.forEach(([name, type]) => {
    try {
        db.prepare(`ALTER TABLE employees ADD COLUMN ${name} ${type}`).run();
        console.log(`  Added column: ${name}`);
    } catch (e) {
        console.log(`  Column exists: ${name}`);
    }
});

console.log('Creating attendance_photos table...');
db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        photo BLOB NOT NULL,
        token TEXT NOT NULL UNIQUE,
        viewed INTEGER DEFAULT 0,
        viewed_at TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_photos_token ON attendance_photos(token);
    CREATE INDEX IF NOT EXISTS idx_attendance_photos_expires ON attendance_photos(expires_at);
`);

console.log('Creating profile_update_requests table...');
db.exec(`
    CREATE TABLE IF NOT EXISTS profile_update_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        reviewed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        review_remarks TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_profile_requests_employee ON profile_update_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_profile_requests_status ON profile_update_requests(status);
`);

const attendanceCols = db.prepare("PRAGMA table_info(attendance)").all().map(c => c.name);
if (!attendanceCols.includes('photo_token')) {
    db.prepare('ALTER TABLE attendance ADD COLUMN photo_token TEXT').run();
    console.log('  Added column: attendance.photo_token');
} else {
    console.log('  Column exists: attendance.photo_token');
}

const empCols = db.prepare("PRAGMA table_info(employees)").all().map(c => c.name);
console.log('');
console.log('Employee columns now:', empCols.length);
console.log('attendance_photos table:', db.prepare("SELECT name FROM sqlite_master WHERE name='attendance_photos'").get() ? 'OK' : 'MISSING');
console.log('profile_update_requests table:', db.prepare("SELECT name FROM sqlite_master WHERE name='profile_update_requests'").get() ? 'OK' : 'MISSING');
db.close();
console.log('Migration complete.');
