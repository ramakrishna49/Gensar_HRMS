const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const { query } = require('./config/database');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/designations', require('./routes/designations'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/wfh', require('./routes/wfh'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/profile-updates', require('./routes/profileUpdates'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/cron', require('./routes/cron'));

// Serve pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/login.html'));
});

app.get(['/admin', '/admin/'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/admin-login.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

// Purge expired / already-viewed check-in photos periodically
async function purgeExpiredPhotos() {
    try {
        const result = await query("DELETE FROM attendance_photos WHERE expires_at < NOW() OR viewed = 1");
        if (result.changes > 0) console.log(`[Photos] Purged ${result.changes} expired/viewed photo(s).`);
    } catch (e) {
        console.error('Photo purge error:', e.message);
    }
}

// One-time repair: recompute payroll net_salary where it does not match basic + allowances - deductions.
// Fixes rows corrupted by the old string-concatenation bug (e.g. "30000" + "400" = "30000400").
async function repairPayrollNetSalaries() {
    try {
        const rows = await query(
            `SELECT id, basic_salary, allowances, deductions, net_salary FROM payroll
             WHERE net_salary != COALESCE(CAST(basic_salary AS DOUBLE PRECISION), 0) + COALESCE(CAST(allowances AS DOUBLE PRECISION), 0) - COALESCE(CAST(deductions AS DOUBLE PRECISION), 0)`
        );
        let fixed = 0;
        for (const r of rows.rows) {
            const net = Number(r.basic_salary || 0) + Number(r.allowances || 0) - Number(r.deductions || 0);
            if (Number(r.net_salary) === net) continue;
            await query('UPDATE payroll SET net_salary = $1 WHERE id = $2', [net, r.id]);
            fixed++;
        }
        if (fixed > 0) console.log(`[Payroll] Recomputed net_salary for ${fixed} corrupted payslip row(s).`);
    } catch (e) {
        console.error('Payroll repair error:', e.message);
    }
}

// Start server (only when run directly, not when imported by the Vercel function)
if (require.main === module) {
    app.listen(PORT, () => {
        repairPayrollNetSalaries();
        purgeExpiredPhotos();
        console.log(`
    ╔══════════════════════════════════════════╗
    ║       GENSAR HRMS Server Started         ║
    ║──────────────────────────────────────────║
    ║  Port: ${PORT}                              ║
    ║  Mode: ${process.env.NODE_ENV || 'development'}                    ║
    ║  URL:  http://localhost:${PORT}             ║
    ╚══════════════════════════════════════════╝
    `);
    });
}

module.exports = app;
