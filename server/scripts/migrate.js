const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { getPool } = require('../config/database');

// Safe migration: applies every statement from schema.sql EXCEPT the seed
// INSERTs. All DDL (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT
// EXISTS, CREATE INDEX IF NOT EXISTS) is idempotent and additive, so running
// this against a live database never drops or overwrites existing data. It is
// used to bring an existing production database up to date with columns that
// were added to schema.sql after the last full `npm run db:init`.
async function migrate() {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set. Add your Supabase connection string to .env first.');
        process.exit(1);
    }

    const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^INSERT/i.test(s));

    console.log(`Applying ${statements.length} schema statements (DDL only, no seed data)...`);
    const pool = getPool();
    let applied = 0;
    try {
        for (const stmt of statements) {
            try {
                await pool.query(stmt);
                applied++;
            } catch (e) {
                console.error(`Statement failed (skipping): ${e.message}`);
                console.error(`  SQL: ${stmt.slice(0, 150)}...`);
            }
        }
        console.log(`Done. ${applied}/${statements.length} statements applied successfully.`);
    } catch (e) {
        console.error('Migration error:', e.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
