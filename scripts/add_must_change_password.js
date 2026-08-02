const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../data/gensar_hrms.db'));
try {
  db.prepare("ALTER TABLE employees ADD COLUMN must_change_password INTEGER DEFAULT 0").run();
  console.log('Column must_change_password added');
} catch(e) {
  console.log('Column exists: ' + e.message);
}
db.close();
