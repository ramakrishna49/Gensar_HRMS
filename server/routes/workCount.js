const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { runWithSchemaRepair, pgErrorResponse } = require('../utils/schemaRepair');
const { logAudit } = require('../utils/audit');
const { istDateString } = require('../utils/date');

const q = (sql, params) => runWithSchemaRepair(() => query(sql, params));

// @route   GET /api/work-count/my-projects
// @desc    Get the signed-in employee's assigned projects with targets
// @access  Private
router.get('/my-projects', verifyToken, async (req, res) => {
    try {
        const result = await q(
            `SELECT p.id, p.name, p.customer_name, p.weekly_target_per_employee, p.working_days
            FROM project_employees pe
            JOIN work_projects p ON p.id = pe.project_id
            WHERE pe.employee_id = $1 AND pe.status = 'active' AND p.status = 'active'
            ORDER BY p.name`,
            [req.user.id]
        );

        const projects = result.rows.map(p => {
            const dailyTarget = p.working_days > 0
                ? Math.round((Number(p.weekly_target_per_employee) / p.working_days) * 100) / 100
                : 0;
            return { ...p, daily_target: dailyTarget };
        });

        res.json({ success: true, projects });
    } catch (error) {
        console.error('My projects error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-count/my
// @desc    Employee's submitted daily counts for a date
// @access  Private
router.get('/my', verifyToken, async (req, res) => {
    try {
        const date = req.query.date || istDateString();
        const result = await q(
            `SELECT dwc.id, dwc.project_id, dwc.work_date, dwc.daily_count, dwc.created_at, dwc.updated_at,
                p.name AS project_name
            FROM daily_work_counts dwc
            JOIN work_projects p ON p.id = dwc.project_id
            WHERE dwc.employee_id = $1 AND dwc.work_date = $2`,
            [req.user.id, date]
        );
        res.json({ success: true, counts: result.rows });
    } catch (error) {
        console.error('My counts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-count/my-week
// @desc    Employee's counts for an entire week (for weekly summary)
// @access  Private
router.get('/my-week', verifyToken, async (req, res) => {
    try {
        const { start, end } = req.query;
        if (!start || !end) {
            return res.status(400).json({ success: false, message: 'start and end dates are required' });
        }

        const result = await q(
            `SELECT dwc.project_id, dwc.work_date, dwc.daily_count, p.name AS project_name
            FROM daily_work_counts dwc
            JOIN work_projects p ON p.id = dwc.project_id
            WHERE dwc.employee_id = $1 AND dwc.work_date >= $2 AND dwc.work_date <= $3`,
            [req.user.id, start, end]
        );
        res.json({ success: true, counts: result.rows });
    } catch (error) {
        console.error('My week counts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/work-count
// @desc    Submit or update a daily count (upsert)
// @access  Private
router.post('/', verifyToken, async (req, res) => {
    try {
        const { project_id, work_date, daily_count } = req.body;

        if (!project_id) {
            return res.status(400).json({ success: false, message: 'Project is required' });
        }
        if (!work_date) {
            return res.status(400).json({ success: false, message: 'Date is required' });
        }
        if (daily_count === undefined || daily_count === null || Number(daily_count) < 0) {
            return res.status(400).json({ success: false, message: 'Daily count must be a non-negative number' });
        }

        const today = istDateString();
        if (work_date > today) {
            return res.status(400).json({ success: false, message: 'Cannot submit count for a future date' });
        }

        // Check Sunday
        const dow = new Date(work_date + 'T00:00:00').getDay();
        if (dow === 0) {
            return res.status(400).json({ success: false, message: 'Cannot submit count for Sunday' });
        }

        // Check work holiday
        const holRes = await q(
            'SELECT id FROM work_holidays WHERE holiday_date = $1',
            [work_date]
        );
        if (holRes.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Cannot submit count for a holiday' });
        }

        // Verify employee is assigned to this project
        const assignRes = await q(
            `SELECT id FROM project_employees
            WHERE project_id = $1 AND employee_id = $2 AND status = 'active'`,
            [project_id, req.user.id]
        );
        if (assignRes.rows.length === 0) {
            return res.status(403).json({ success: false, message: 'You are not assigned to this project' });
        }

        // Upsert
        const result = await q(
            `INSERT INTO daily_work_counts (project_id, employee_id, work_date, daily_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (project_id, employee_id, work_date)
            DO UPDATE SET daily_count = $4, updated_at = NOW()
            RETURNING *`,
            [project_id, req.user.id, work_date, Number(daily_count)]
        );

        const isUpdate = result.rows[0].created_at !== result.rows[0].updated_at;

        logAudit({
            actorId: req.user.id,
            action: isUpdate ? 'work_count.update' : 'work_count.submit',
            entityType: 'daily_work_count',
            entityId: result.rows[0].id,
            details: { project_id, work_date, daily_count: Number(daily_count) },
            ip: req.ip
        });

        res.json({
            success: true,
            count: result.rows[0],
            message: isUpdate ? 'Count updated' : 'Count submitted'
        });
    } catch (error) {
        console.error('Submit count error:', error);
        const errResp = pgErrorResponse(error);
        res.status(errResp.status).json({ success: false, message: errResp.message });
    }
});

// @route   PUT /api/work-count/:id
// @desc    Edit a submitted count (employee own or admin any)
// @access  Private
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { daily_count } = req.body;
        if (daily_count === undefined || daily_count === null || Number(daily_count) < 0) {
            return res.status(400).json({ success: false, message: 'Daily count must be a non-negative number' });
        }

        // Fetch existing record
        const existing = await q(
            'SELECT * FROM daily_work_counts WHERE id = $1',
            [req.params.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Record not found' });
        }

        const record = existing.rows[0];
        // Employees can only edit their own; admins can edit any
        if (req.user.role !== 'admin' && Number(record.employee_id) !== Number(req.user.id)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const result = await q(
            `UPDATE daily_work_counts SET daily_count = $1, updated_at = NOW()
            WHERE id = $2 RETURNING *`,
            [Number(daily_count), req.params.id]
        );

        logAudit({
            actorId: req.user.id,
            action: 'work_count.admin_edit',
            entityType: 'daily_work_count',
            entityId: result.rows[0].id,
            details: { project_id: record.project_id, work_date: String(record.work_date).substring(0, 10), old_count: Number(record.daily_count), new_count: Number(daily_count) },
            ip: req.ip
        });

        res.json({ success: true, count: result.rows[0] });
    } catch (error) {
        console.error('Edit count error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-count/admin/all
// @desc    Admin: all counts for a date range, filterable by project
// @access  Admin
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { project_id, start, end } = req.query;
        let sql = `SELECT dwc.*, p.name AS project_name,
                e.first_name, e.last_name, e.employee_id AS emp_code
            FROM daily_work_counts dwc
            JOIN work_projects p ON p.id = dwc.project_id
            JOIN employees e ON e.id = dwc.employee_id
            WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (project_id) {
            sql += ` AND dwc.project_id = $${idx}`;
            params.push(project_id);
            idx++;
        }
        if (start) {
            sql += ` AND dwc.work_date >= $${idx}`;
            params.push(start);
            idx++;
        }
        if (end) {
            sql += ` AND dwc.work_date <= $${idx}`;
            params.push(end);
            idx++;
        }

        sql += ' ORDER BY dwc.work_date DESC, p.name, e.first_name';
        const result = await q(sql, params);

        res.json({ success: true, counts: result.rows });
    } catch (error) {
        console.error('Admin all counts error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
