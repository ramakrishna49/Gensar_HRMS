const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { runAutoMark } = require('../services/attendanceAutoMark');

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` if configured, and also
// an `x-vercel-cron` header. Allow either so the endpoints can't be hit publicly.
function isCronAuthorized(req) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        return req.headers.authorization === `Bearer ${secret}`;
    }
    return req.headers['x-vercel-cron'] === '1';
}

router.get('/auto-attendance', async (req, res) => {
    if (!isCronAuthorized(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const marked = await runAutoMark();
        res.json({ success: true, marked });
    } catch (error) {
        console.error('Auto-attendance cron error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/purge-photos', async (req, res) => {
    if (!isCronAuthorized(req)) return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const result = await query("DELETE FROM attendance_photos WHERE expires_at < NOW() OR viewed = 1");
        res.json({ success: true, deleted: result.changes });
    } catch (error) {
        console.error('Purge photos cron error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
