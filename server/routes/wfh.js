const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

function isWeekend(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    return day === 0 || day === 6;
}

function calcBusinessDays(start, end) {
    let count = 0;
    const s = new Date(start);
    const e = new Date(end);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }
    return count;
}

router.post('/apply', verifyToken, async (req, res) => {
    try {
        const { start_date, end_date, reason } = req.body;

        if (!start_date || !end_date) {
            return res.status(400).json({ success: false, message: 'Start and end dates are required' });
        }

        if (new Date(end_date) < new Date(start_date)) {
            return res.status(400).json({ success: false, message: 'End date must be after start date' });
        }

        if (isWeekend(start_date)) {
            return res.status(400).json({ success: false, message: 'Start date cannot be a weekend' });
        }

        const empRes = await query(
            'SELECT role, reporting_manager_id FROM employees WHERE id = $1', [req.user.id]
        );
        const emp = empRes.rows[0];
        if (!emp) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        const needsManager = emp.role === 'employee' || emp.role === 'manager' || emp.role === 'team_lead' || emp.role === 'hr';
        if (needsManager && !emp.reporting_manager_id) {
            return res.status(400).json({ success: false, message: 'No reporting manager assigned. Contact your administrator.' });
        }
        const reporting_manager_id = needsManager ? emp.reporting_manager_id : null;

        const totalDays = calcBusinessDays(start_date, end_date);

        const result = await query(
            `INSERT INTO wfh_requests (employee_id, reporting_manager_id, start_date, end_date, total_days, reason)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [req.user.id, reporting_manager_id, start_date, end_date, totalDays, reason]
        );

        res.status(201).json({ success: true, wfh: result.rows[0] });
    } catch (error) {
        console.error('WFH apply error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/my', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT wr.*,
            e.first_name || ' ' || e.last_name as approved_by_name
            FROM wfh_requests wr
            LEFT JOIN employees e ON wr.approved_by = e.id
            WHERE wr.employee_id = $1
            ORDER BY wr.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, wfhRequests: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let sqlQuery = `SELECT wr.*,
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id, d.name as department_name
            FROM wfh_requests wr
            JOIN employees e ON wr.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (status && status !== 'all') {
            sqlQuery += ` AND wr.status = $${idx}`;
            params.push(status);
            idx++;
        }

        sqlQuery += ' ORDER BY wr.created_at DESC';
        const result = await query(sqlQuery, params);

        const counts = await query(
            `SELECT status, COUNT(*) as count FROM wfh_requests GROUP BY status`
        );
        const statusCounts = { pending: 0, approved: 0, rejected: 0 };
        counts.rows.forEach(r => { statusCounts[r.status] = r.count; });

        res.json({ success: true, wfhRequests: result.rows, counts: statusCounts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/pending', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT wr.*,
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id
            FROM wfh_requests wr
            JOIN employees e ON wr.employee_id = e.id
            WHERE wr.status = 'pending'
            ORDER BY wr.created_at DESC`
        );
        res.json({ success: true, wfhRequests: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/approve/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status, remarks } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const wfhApp = await query(
            'SELECT * FROM wfh_requests WHERE id = $1', [req.params.id]
        );
        if (wfhApp.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'WFH request not found' });
        }

        const result = await query(
            `UPDATE wfh_requests
            SET status = $1, approved_by = $2, approval_remarks = $3, updated_at = NOW()
            WHERE id = $4 RETURNING *`,
            [status, req.user.id, remarks, req.params.id]
        );

        res.json({ success: true, wfh: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
