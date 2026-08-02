const Database = require('better-sqlite3');
const db = new Database('./data/gensar_hrms.db');
db.prepare(
