const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { istDateString } = require('../utils/date');
const { rateLimit, clientIp } = require('../utils/rateLimit');

// Public TV-display feed. Deliberately unauthenticated (the page runs on an
// office TV where nobody logs in) and deliberately privacy-safe: counts,
// first names, holiday and announcement text only. No emails, phones,
// photos, salaries or any PII leave the server through this route.
const displayLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyFn: (req) => 'display:' + clientIp(req),
    message: 'Too many requests'
});

function truncate(text, max) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    return s.substring(0, max - 1).trimEnd() + '…';
}

// @route   GET /api/display/today
// @desc    Privacy-safe snapshot for the office TV display
// @access  Public (rate limited)
router.get('/today', displayLimiter, async (req, res) => {
    try {
        const today = istDateString(); // YYYY-MM-DD (IST)
        const mmdd = today.substring(5);
        const year = parseInt(today.substring(0, 4), 10);

        const [activeRes, presentRes, bdayRes, annRes, holRes, annnRes] = await Promise.all([
            query(
                `SELECT COUNT(*)::int AS total FROM employees WHERE status = 'active' AND role <> 'admin'`
            ),
            query(
                `SELECT COUNT(DISTINCT employee_id)::int AS present FROM attendance
                WHERE date = $1 AND check_in IS NOT NULL`,
                [today]
            ),
            query(
                `SELECT first_name FROM employees
                WHERE status = 'active' AND date_of_birth IS NOT NULL
                  AND to_char(date_of_birth, 'MM-DD') = $1
                ORDER BY first_name`,
                [mmdd]
            ),
            query(
                `SELECT first_name, joining_date FROM employees
                WHERE status = 'active' AND joining_date IS NOT NULL
                  AND to_char(joining_date, 'MM-DD') = $1`,
                [mmdd]
            ),
            query(
                `SELECT name, to_char(date, 'YYYY-MM-DD') AS date FROM holidays
                WHERE is_active = 1 AND date >= $1
                ORDER BY date ASC LIMIT 4`,
                [today]
            ),
            query(
                `SELECT title, content FROM announcements
                WHERE is_active = 1 AND target_audience IN ('all', 'employee')
                ORDER BY created_at DESC LIMIT 5`
            )
        ]);

        const totalActive = activeRes.rows[0].total;
        const presentToday = Math.min(presentRes.rows[0].present, totalActive);

        const birthdays = bdayRes.rows.map(r => ({ name: r.first_name }));

        // Anniversaries: joined on this month-day in a PREVIOUS year.
        const anniversaries = annRes.rows.map(r => ({
            name: r.first_name,
            years: year - new Date(r.joining_date).getFullYear()
        })).filter(a => a.years >= 1);

        res.json({
            success: true,
            today,
            attendance: { present: presentToday, total: totalActive },
            birthdays,
            anniversaries,
            upcomingHolidays: holRes.rows.map(h => ({ name: h.name, date: h.date })),
            announcements: annnRes.rows.map(a => ({
                title: a.title,
                content: truncate(a.content, 160)
            }))
        });
    } catch (error) {
        console.error('Display feed error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
