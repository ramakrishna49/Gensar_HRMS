const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { getPool } = require('../config/database');

async function initDatabase() {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set. Add your Supabase connection string to .env first.');
        process.exit(1);
    }

    console.log('Applying schema to Postgres/Supabase...');
    const pool = getPool();
    try {
        await pool.query(schema);
        console.log('Schema applied successfully!');
        console.log('');
        console.log('Default Admin Login:');
        console.log('  Email: admin@gensar.com');
        console.log('  Password: admin123');
        console.log('');
        console.log('Demo Employee Logins:');
        console.log('  Email: rahul@gensar.com / Password: welcome123');
        console.log('  Email: priya@gensar.com / Password: welcome123');
        console.log('  Email: amit@gensar.com / Password: welcome123');
    } catch (error) {
        console.error('Error applying schema:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

initDatabase();
