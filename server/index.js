const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const { query } = require('./config/database');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
function purgeExpiredPhotos() {
    try {
        query("DELETE FROM attendance_photos WHERE expires_at < datetime('now') OR viewed = 1");
    } catch (e) {
        console.error('Photo purge error:', e.message);
    }
}

// One-time repair: recompute payroll net_salary where it does not match basic + allowances - deductions.
// Fixes rows corrupted by the old string-concatenation bug (e.g. "30000" + "400" = "30000400").
function repairPayrollNetSalaries() {
    try {
        const rows = query(
            `SELECT id, basic_salary, allowances, deductions, net_salary FROM payroll
             WHERE net_salary != COALESCE(CAST(basic_salary AS REAL), 0) + COALESCE(CAST(allowances AS REAL), 0) - COALESCE(CAST(deductions AS REAL), 0)`
        ).rows;
        let fixed = 0;
        for (const r of rows) {
            const net = Number(r.basic_salary || 0) + Number(r.allowances || 0) - Number(r.deductions || 0);
            if (Number(r.net_salary) === net) continue;
            query('UPDATE payroll SET net_salary = $1 WHERE id = $2', [net, r.id]);
            fixed++;
        }
        if (fixed > 0) console.log(`[Payroll] Recomputed net_salary for ${fixed} corrupted payslip row(s).`);
    } catch (e) {
        console.error('Payroll repair error:', e.message);
    }
}

// Start server
app.listen(PORT, () => {
    repairPayrollNetSalaries();
    purgeExpiredPhotos();
    setInterval(purgeExpiredPhotos, 60 * 60 * 1000);
    const { startAutoMarkScheduler } = require('./services/attendanceAutoMark');
    startAutoMarkScheduler();
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

module.exports = app;
