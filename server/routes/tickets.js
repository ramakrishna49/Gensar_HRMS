const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.post('/', verifyToken, async (req, res) => {
    try {
        const { category, subject, description, priority } = req.body;

        if (!category || !subject) {
            return res.status(400).json({ success: false, message: 'Category and subject are required' });
        }

        if (!subject.trim() || subject.trim().length < 3) {
            return res.status(400).json({ success: false, message: 'Subject must be at least 3 characters' });
        }

        const validPriorities = ['low', 'medium', 'high'];
        const prio = validPriorities.includes(priority) ? priority : 'medium';

        const result = await query(
            `INSERT INTO support_tickets (employee_id, category, subject, description, priority)
            VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.user.id, category, subject.trim(), description || '', prio]
        );

        res.status(201).json({ success: true, ticket: result.rows[0] });
    } catch (error) {
        console.error('Ticket create error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/my', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT st.*,
            e.first_name || ' ' || e.last_name as responded_by_name
            FROM support_tickets st
            LEFT JOIN employees e ON st.responded_by = e.id
            WHERE st.employee_id = $1
            ORDER BY st.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, tickets: result.rows });
    } catch (error) {
        console.error('My tickets error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let sqlQuery = `SELECT st.*,
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id,
            e2.first_name || ' ' || e2.last_name as responded_by_name
            FROM support_tickets st
            JOIN employees e ON st.employee_id = e.id
            LEFT JOIN employees e2 ON st.responded_by = e2.id
            WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (status && status !== 'all') {
            sqlQuery += ` AND st.status = $${idx}`;
            params.push(status);
            idx++;
        }

        sqlQuery += ' ORDER BY st.created_at DESC';
        const result = await query(sqlQuery, params);

        const counts = await query(
            `SELECT status, COUNT(*) as count FROM support_tickets GROUP BY status`
        );
        const statusCounts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
        counts.rows.forEach(r => { statusCounts[r.status] = r.count; });

        res.json({ success: true, tickets: result.rows, counts: statusCounts });
    } catch (error) {
        console.error('All tickets error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/pending', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT st.*,
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id
            FROM support_tickets st
            JOIN employees e ON st.employee_id = e.id
            WHERE st.status IN ('open', 'in_progress')
            ORDER BY st.created_at DESC`
        );
        res.json({ success: true, tickets: result.rows });
    } catch (error) {
        console.error('Pending tickets error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/respond/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status, response } = req.body;
        if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const ticket = await query(
            'SELECT * FROM support_tickets WHERE id = $1', [req.params.id]
        );
        if (ticket.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        const result = await query(
            `UPDATE support_tickets
            SET status = $1, admin_response = $2, responded_by = $3,
                responded_at = NOW(), updated_at = NOW()
            WHERE id = $4 RETURNING *`,
            [status, response || '', req.user.id, req.params.id]
        );

        res.json({ success: true, ticket: result.rows[0] });
    } catch (error) {
        console.error('Ticket respond error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
