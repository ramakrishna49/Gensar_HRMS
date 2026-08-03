const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { sendToAudience } = require('../services/push');

router.get('/', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT a.*, e.first_name || ' ' || e.last_name as posted_by_name,
            CASE WHEN ar.id IS NOT NULL THEN 1 ELSE 0 END as is_read
            FROM announcements a
            LEFT JOIN employees e ON a.posted_by = e.id
            LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.employee_id = $1
            WHERE a.is_active = 1
            ORDER BY a.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, announcements: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/unread-count', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT COUNT(*) as count FROM announcements a
            WHERE a.is_active = 1
            AND a.id NOT IN (
                SELECT announcement_id FROM announcement_reads WHERE employee_id = $1
            )`,
            [req.user.id]
        );
        res.json({ success: true, count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/read-all', verifyToken, async (req, res) => {
    try {
        await query(
            `INSERT INTO announcement_reads (employee_id, announcement_id)
            SELECT $1, a.id FROM announcements a
            WHERE a.is_active = 1
            AND a.id NOT IN (
                SELECT announcement_id FROM announcement_reads WHERE employee_id = $1
            )`,
            [req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/:id/read', verifyToken, async (req, res) => {
    try {
        const existing = await query(
            'SELECT id FROM announcement_reads WHERE employee_id = $1 AND announcement_id = $2',
            [req.user.id, req.params.id]
        );
        if (existing.rows.length === 0) {
            await query(
                'INSERT INTO announcement_reads (employee_id, announcement_id) VALUES ($1, $2)',
                [req.user.id, req.params.id]
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { title, content, priority, target_audience } = req.body;
        if (!title || !content) return res.status(400).json({ success: false, message: 'Title and content required' });
        
        const result = await query(
            `INSERT INTO announcements (title, content, priority, posted_by, target_audience) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [title, content, priority || 'normal', req.user.id, target_audience || 'all']
        );

        try {
            const sent = await sendToAudience(target_audience || 'all', {
                title: priority === 'urgent' ? 'Urgent Announcement' : 'New Announcement',
                body: title,
                url: '/pages/employee/announcements.html'
            });
            if (sent.sent > 0) console.log(`[Push] Announcement "${title}" sent to ${sent.sent} device(s)`);
        } catch (e) { console.error('Push notify error:', e.message); }

        res.status(201).json({ success: true, announcement: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { title, content, priority, target_audience } = req.body;
        const result = await query(
            `UPDATE announcements SET title = COALESCE($1, title), content = COALESCE($2, content), 
            priority = COALESCE($3, priority), target_audience = COALESCE($4, target_audience) 
            WHERE id = $5 RETURNING *`,
            [title, content, priority, target_audience, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, announcement: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            'UPDATE announcements SET is_active = 0 WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
