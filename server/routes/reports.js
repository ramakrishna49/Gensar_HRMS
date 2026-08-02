const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.get('/dashboard', verifyToken, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        const [totalEmp, presentToday, absentToday, pendingLeaves, departments, lateToday, todayRows, pendingProfileUpdates] = await Promise.all([
            query("SELECT COUNT(*) as count FROM employees WHERE status = 'active' AND role != 'admin'"),
            query("SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND status IN ('present', 'late', 'half-day') AND employee_id IN (SELECT id FROM employees WHERE role != 'admin')", [today]),
            query("SELECT COUNT(*) as count FROM employees WHERE status = 'active' AND role != 'admin' AND id NOT IN (SELECT employee_id FROM attendance WHERE date = $1)", [today]),
            query("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'"),
            query("SELECT COUNT(*) as count FROM departments"),
            query("SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND status = 'late' AND employee_id IN (SELECT id FROM employees WHERE role != 'admin')", [today]),
            query(
                `SELECT a.id, a.employee_id, a.check_in, a.check_out, a.status, a.check_in_location,
                 e.first_name, e.last_name, e.employee_id as emp_id, d.name as department_name
                 FROM attendance a
                 JOIN employees e ON a.employee_id = e.id
                 LEFT JOIN departments d ON e.department_id = d.id
                 WHERE a.date = $1 AND e.role != 'admin'
                 ORDER BY a.check_in DESC, e.first_name`,
                [today]
            ),
            query("SELECT COUNT(*) as count FROM profile_update_requests WHERE status = 'pending'")
        ]);
        
        res.json({
            success: true,
            stats: {
                totalEmployees: parseInt(totalEmp.rows[0].count),
                presentToday: parseInt(presentToday.rows[0].count),
                absentToday: parseInt(absentToday.rows[0].count),
                pendingLeaves: parseInt(pendingLeaves.rows[0].count),
                totalDepartments: parseInt(departments.rows[0].count),
                lateToday: parseInt(lateToday.rows[0].count),
                pendingProfileUpdates: parseInt(pendingProfileUpdates.rows[0].count)
            },
            todayAttendance: todayRows.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/employees', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT d.name as department, COUNT(e.id) as count 
            FROM employees e 
            JOIN departments d ON e.department_id = d.id 
            WHERE e.status = 'active' AND e.role != 'admin'
            GROUP BY d.name ORDER BY d.name`
        );
        res.json({ success: true, report: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/attendance', verifyToken, isAdmin, async (req, res) => {
    try {
        const { month, year } = req.query;
        const m = String(month || new Date().getMonth() + 1).padStart(2, '0');
        const y = String(year || new Date().getFullYear());
        const result = await query(
            `SELECT a.status, COUNT(*) as count 
            FROM attendance a 
            WHERE strftime('%m', a.date) = $1 AND strftime('%Y', a.date) = $2 
            GROUP BY a.status`,
            [m, y]
        );
        res.json({ success: true, report: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
