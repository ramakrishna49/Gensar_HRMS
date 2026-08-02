const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { validateLeave } = require('../middleware/validation');

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

router.get('/types', verifyToken, async (req, res) => {
    try {
        const user = await query('SELECT gender FROM employees WHERE id = $1', [req.user.id]);
        const gender = user.rows[0]?.gender || 'all';

        const result = await query(
            `SELECT * FROM leave_types WHERE is_active = 1 AND (gender_eligibility = 'all' OR gender_eligibility = $1) ORDER BY name`,
            [gender]
        );
        res.json({ success: true, leaveTypes: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/apply', verifyToken, validateLeave, async (req, res) => {
    try {
        const { leave_type_id, start_date, end_date, reason } = req.body;

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

        const genderCheck = await query(
            `SELECT lt.gender_eligibility, e.gender FROM leave_types lt
            JOIN employees e ON e.id = $2 WHERE lt.id = $1`,
            [leave_type_id, req.user.id]
        );
        if (genderCheck.rows.length > 0) {
            const { gender_eligibility, gender } = genderCheck.rows[0];
            if (gender_eligibility !== 'all' && gender_eligibility !== gender) {
                return res.status(400).json({ success: false, message: `This leave type is only available for ${gender_eligibility} employees` });
            }
        }

        const totalDays = calcBusinessDays(start_date, end_date);

        const result = await query(
            `INSERT INTO leave_applications (employee_id, leave_type_id, reporting_manager_id, start_date, end_date, total_days, reason) 
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [req.user.id, leave_type_id, reporting_manager_id, start_date, end_date, totalDays, reason]
        );

        res.status(201).json({ success: true, leave: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/my', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT la.*, lt.name as leave_type_name, 
            e.first_name || ' ' || e.last_name as approved_by_name
            FROM leave_applications la
            LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
            LEFT JOIN employees e ON la.approved_by = e.id
            WHERE la.employee_id = $1
            ORDER BY la.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, leaves: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let sqlQuery = `SELECT la.*, lt.name as leave_type_name, 
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id, d.name as department_name
            FROM leave_applications la
            LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
            JOIN employees e ON la.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE 1=1`;
        const params = [];
        let idx = 1;

        if (status && status !== 'all') {
            sqlQuery += ` AND la.status = $${idx}`;
            params.push(status);
            idx++;
        }

        sqlQuery += ' ORDER BY la.created_at DESC';
        const result = await query(sqlQuery, params);

        const counts = await query(
            `SELECT status, COUNT(*) as count FROM leave_applications GROUP BY status`
        );
        const statusCounts = { pending: 0, approved: 0, rejected: 0 };
        counts.rows.forEach(r => { statusCounts[r.status] = r.count; });

        res.json({ success: true, leaves: result.rows, counts: statusCounts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/pending', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT la.*, lt.name as leave_type_name, 
            e.first_name || ' ' || e.last_name as employee_name,
            e.employee_id as emp_id
            FROM leave_applications la
            LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
            JOIN employees e ON la.employee_id = e.id
            WHERE la.status = 'pending'
            ORDER BY la.created_at DESC`
        );
        res.json({ success: true, leaves: result.rows });
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
        
        const leaveApp = await query(
            'SELECT * FROM leave_applications WHERE id = $1', [req.params.id]
        );
        if (leaveApp.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Leave application not found' });
        }
        
        const result = await query(
            `UPDATE leave_applications 
            SET status = $1, approved_by = $2, approval_remarks = $3, updated_at = NOW() 
            WHERE id = $4 RETURNING *`,
            [status, req.user.id, remarks, req.params.id]
        );
        
        if (status === 'approved') {
            const app = leaveApp.rows[0];
            const start = new Date(app.start_date);
            const end = new Date(app.end_date);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const existing = await query(
                    'SELECT id FROM attendance WHERE employee_id = $1 AND date = $2',
                    [app.employee_id, dateStr]
                );
                if (existing.rows.length === 0) {
                    await query(
                        `INSERT INTO attendance (employee_id, date, status, remarks) 
                        VALUES ($1, $2, 'absent', $3)`,
                        [app.employee_id, dateStr, 'On leave: ' + (remarks || app.reason || '')]
                    );
                }
            }
        }
        
        res.json({ success: true, leave: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/balance', verifyToken, async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        
        const user = await query('SELECT gender FROM employees WHERE id = $1', [req.user.id]);
        const gender = user.rows[0]?.gender || 'all';
        
        const result = await query(
            `SELECT lt.id, lt.name, lt.days_per_year, lt.gender_eligibility,
            COALESCE(SUM(la.total_days), 0) as used_days
            FROM leave_types lt
            LEFT JOIN leave_applications la ON lt.id = la.leave_type_id 
            AND la.employee_id = $1 
            AND to_char(la.start_date, 'YYYY') = $2
            AND la.status IN ('approved', 'pending')
            WHERE lt.is_active = 1 AND (lt.gender_eligibility = 'all' OR lt.gender_eligibility = $3)
            GROUP BY lt.id, lt.name, lt.days_per_year, lt.gender_eligibility
            ORDER BY lt.name`,
            [req.user.id, String(currentYear), gender]
        );
        
        const balances = result.rows.map(row => ({
            ...row,
            remaining_days: Math.max(0, row.days_per_year - row.used_days),
            percentage: row.days_per_year > 0 ? Math.round((row.used_days / row.days_per_year) * 100) : 0
        }));
        
        res.json({ success: true, balances });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
