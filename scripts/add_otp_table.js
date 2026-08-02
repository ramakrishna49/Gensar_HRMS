const { sqlite } = require('../server/config/database');

try {
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_otps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            otp TEXT NOT NULL,
            reset_token TEXT,
            is_used INTEGER DEFAULT 0,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);
    console.log('Migration: password_reset_otps table created/verified successfully.');
} catch (error) {
    console.error('Migration error:', error.message);
}

sqlite.close();