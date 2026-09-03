const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
// Behind Vercel's proxy, req.ip would otherwise always be 127.0.0.1.
// Trusting the proxy makes Express read the real client IP from
// x-forwarded-for so audit logs record where logins actually came from.
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const { query } = require('./config/database');

// Middleware
// 15MB JSON limit: payroll generate/generate-bulk payloads carry base64 PDFs
// (default 100KB limit rejected them with 413). Vercel caps at ~4.5MB anyway,
// and the bulk flow chunks requests client-side to stay under that.
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// CORS lock-down: only the origins listed in ALLOWED_ORIGINS may call the API
// from a browser. Requests without an Origin header (mobile apps, curl,
// server-to-server) are still allowed since they are not subject to CORS.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
    'https://gensarhrms.in,https://www.gensarhrms.in,http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
    }
}));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/designations', require('./routes/designations'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/regularization', require('./routes/regularization'));
app.use('/api/leave', require('./routes/leave'));
app.use('/api/wfh', require('./routes/wfh'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/letters', require('./routes/letters'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/profile-updates', require('./routes/profileUpdates'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/manager', require('./routes/manager'));
app.use('/api/push', require('./routes/push'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/project-sets', require('./routes/project-sets'));
app.use('/api/daily-work-counts', require('./routes/daily-work-counts'));

// Serve pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/login.html'));
});

app.get(['/admin', '/admin/'], (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/admin-login.html'));
});

// Clean professional URLs: /admin/employees serves pages/admin/employees.html,
// /employee/leave serves pages/employee/leave.html, and so on. The slug is
// strictly validated ([a-z0-9-]) so path traversal is impossible; unknown
// slugs fall through to the 404 handler. The original /pages/*.html paths keep
// working via express.static, so old bookmarks and push links never break.
function servePortalPage(section) {
    return (req, res, next) => {
        let page = req.params.page;
        // Tolerate legacy "/admin/x.html" style links: strip the extension so
        // any missed relative reference still resolves to the clean page.
        if (page && page.toLowerCase().endsWith('.html')) page = page.slice(0, -5);
        if (!/^[a-z0-9-]+$/.test(page)) return next();
        const file = path.join(__dirname, '..', 'public', 'pages', section, page + '.html');
        if (!fs.existsSync(file)) return next();
        res.sendFile(file);
    };
}
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/login.html'));
});
app.get('/manager/my-team', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/pages/manager/my-team.html'));
});
app.get('/employee/:page', servePortalPage('employee'));
app.get('/admin/:page', servePortalPage('admin'));

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

// One-time repair: recompute payroll net_salary where it does not match the current
// formula net = gross(A) + bonus(C) - deductions(B) - employer(D).
// Fixes rows corrupted by the old string-concatenation bug (e.g. "30000" + "400" = "30000400").
async function repairPayrollNetSalaries() {
    try {
        const rows = await query(
            `SELECT id,
                COALESCE(CAST(basic_salary AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(hra AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(conveyance AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(medical AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(special_allowance AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(other_allowance AS DOUBLE PRECISION), 0) AS gross,
                COALESCE(CAST(pf AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(esi AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(professional_tax AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(income_tax AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(loan_deduction AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(advance_salary AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(other_deduction AS DOUBLE PRECISION), 0) AS deductions,
                COALESCE(CAST(bonus AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(incentive AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(extra_work AS DOUBLE PRECISION), 0) AS bonus,
                COALESCE(CAST(employer_pf AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(employer_esi AS DOUBLE PRECISION), 0)
                  + COALESCE(CAST(employer_contribution AS DOUBLE PRECISION), 0) AS employer,
                net_salary FROM payroll`
        );
        let fixed = 0;
        for (const r of rows.rows) {
            const net = Number(r.gross || 0) + Number(r.bonus || 0) - Number(r.deductions || 0) - Number(r.employer || 0);
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

// Auto-migration: runs on every server start (Vercel or local). Idempotent.
async function runLeaveTypeMigration() {
    try {
        await query(`INSERT INTO leave_types (name, days_per_year, description, gender_eligibility) VALUES ('Sick or Casual', 12, 'For medical or casual reasons (1 paid day per month, rest LOP)', 'all') ON CONFLICT (name) DO NOTHING`);
        await query(`UPDATE leave_types SET is_active = 1, days_per_year = 12 WHERE name = 'Sick or Casual'`);
        await query(`UPDATE leave_types SET is_active = 0 WHERE name IN ('Sick Leave', 'Casual Leave')`);
        await query(`UPDATE leave_types SET is_active = 0 WHERE name IN ('Maternity Leave', 'Paternity Leave', 'Unpaid Leave', 'Earned Leave')`);
        await query(`UPDATE leave_types SET days_per_year = 0 WHERE name IN ('Maternity Leave', 'Paternity Leave')`);
    } catch (e) { /* table may not exist yet */ }
}
runLeaveTypeMigration();

// Auto-migration: add multi-approver columns to request tables.
async function runMultiApproverMigration() {
    try {
        await query(`ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        await query(`ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS hr_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        await query(`ALTER TABLE wfh_requests ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        await query(`ALTER TABLE wfh_requests ADD COLUMN IF NOT EXISTS hr_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        await query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS manager_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        await query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS hr_id INT REFERENCES employees(id) ON DELETE SET NULL`);
        console.log('[Migration] Multi-approver columns ensured.');
    } catch (e) { /* table may not exist yet */ }
}
runMultiApproverMigration();

module.exports = app;
