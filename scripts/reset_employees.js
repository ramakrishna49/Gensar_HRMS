const path = require('path');
const Database = require('better-sqlite3');
const backupDb = require('./backup_db');

const DB_PATH = path.join(__dirname, '../data/gensar_hrms.db');

if (!process.argv.includes('--force')) {
    console.log('WARNING: This deletes ALL non-admin employees and their data.');
    console.log('A backup is created automatically first.');
    console.log('Run again with --force to proceed.');
    process.exit(0);
}

console.log('Creating backup before reset...');
backupDb();

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const admins = db.prepare("SELECT id FROM employees WHERE role = 'admin' OR email = 'admin@gensar.com'").all();
const adminIds = admins.map(a => a.id);

if (adminIds.length === 0) {
    console.log('No admin account found. Aborting to avoid wiping everything.');
    process.exit(1);
}

const before = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;

const deleteEmp = db.prepare(`DELETE FROM employees WHERE role != 'admin' AND email != 'admin@gensar.com'`);
const info = deleteEmp.run();

const after = db.prepare('SELECT COUNT(*) as c FROM employees').get().c;
const empAfter = db.prepare('SELECT id, first_name, last_name, email FROM employees').all();

console.log(`Employees before: ${before}, after: ${after} (${info.changes} removed)`);
console.log('Remaining employees:');
empAfter.forEach(e => console.log(`  [${e.id}] ${e.first_name} ${e.last_name} <${e.email}>`));

const orphans = db.prepare(`
    SELECT 'attendance' as t, COUNT(*) as c FROM attendance WHERE employee_id NOT IN (SELECT id FROM employees)
    UNION ALL SELECT 'attendance_photos', COUNT(*) FROM attendance_photos WHERE employee_id NOT IN (SELECT id FROM employees)
    UNION ALL SELECT 'leave_applications', COUNT(*) FROM leave_applications WHERE employee_id NOT IN (SELECT id FROM employees)
    UNION ALL SELECT 'payroll', COUNT(*) FROM payroll WHERE employee_id NOT IN (SELECT id FROM employees)
    UNION ALL SELECT 'documents', COUNT(*) FROM documents WHERE employee_id NOT IN (SELECT id FROM employees)
    UNION ALL SELECT 'profile_update_requests', COUNT(*) FROM profile_update_requests WHERE employee_id NOT IN (SELECT id FROM employees)
`).all();

const orphanTotal = orphans.reduce((s, o) => s + o.c, 0);
console.log(`Orphaned rows remaining: ${orphanTotal}`);
orphans.forEach(o => { if (o.c > 0) console.log(`  ${o.t}: ${o.c}`); });

db.close();
console.log('Reset complete. Master data (departments, designations, leave types, holidays, announcements, settings) preserved.');
