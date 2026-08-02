const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../data/gensar_hrms.db');
const BACKUP_DIR = path.join(__dirname, '../backups');

function timestamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function backupDb(destPath) {
    if (!fs.existsSync(DB_PATH)) {
        throw new Error('Database not found: ' + DB_PATH);
    }
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const target = destPath || path.join(BACKUP_DIR, `gensar_hrms_${timestamp()}.db`);
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.backup(target)
        .then(() => {
            db.close();
            console.log('Backup created:', target);
        })
        .catch(err => {
            db.close();
            throw err;
        });
}

if (require.main === module) {
    backupDb();
}

module.exports = backupDb;
