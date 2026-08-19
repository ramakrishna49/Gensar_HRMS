const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isManager } = require('../middleware/auth');
const { istDateString } = require('../utils/date');
const { sendToUser } = require('../services/push');

// @route   GET /api/manager/team
// @desc    Get current user's direct reports
// @access  Private (Manager+)
router.get('/team', verifyToken, isManager, async (req, res) => {
    try {
        const result = await query(
            `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email, e.role, e.status,
            d.name as department_name, des.name as designation_name
            FROM employees e
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN designations des ON e.designation_id = des.id
            WHERE e.reporting_manager_id = $1 AND e.status = 'active'
            ORDER BY e.first_name`,
            [req.user.id]
        );
        res.json({ success: true, team: result.rows });
    } catch (error) {
        console.error('Get team error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/manager/leaves
// @desc    Pending leave requests from direct reports
// @access  Private (Manager+)
router.get('/leaves', verifyToken, isManager, async (req, res) => {
    try {
        const result = await query(
            `SELECT la.*, lt.name as leave_type_name,
            e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id,
            d.name as department_name
            FROM leave_applications la
            LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
            JOIN employees e ON la.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE la.status = 'pending' AND la.reporting_manager_id = $1
            ORDER BY la.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, leaves: result.rows });
    } catch (error) {
        console.error('Manager leaves error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/manager/wfh
// @desc    Pending WFH requests from direct reports
// @access  Private (Manager+)
router.get('/wfh', verifyToken, isManager, async (req, res) => {
    try {
        const result = await query(
            `SELECT wr.*,
            e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id,
            d.name as department_name
            FROM wfh_requests wr
            JOIN employees e ON wr.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE wr.status = 'pending' AND wr.reporting_manager_id = $1
            ORDER BY wr.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, wfhRequests: result.rows });
    } catch (error) {
        console.error('Manager WFH error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/manager/tickets
// @desc    Open/in-progress queries from direct reports
// @access  Private (Manager+)
router.get('/tickets', verifyToken, isManager, async (req, res) => {
    try {
        const result = await query(
            `SELECT st.*,
            e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
            FROM support_tickets st
            JOIN employees e ON st.employee_id = e.id
            WHERE st.status IN ('open', 'in_progress') AND st.reporting_manager_id = $1
            ORDER BY st.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, tickets: result.rows });
    } catch (error) {
        console.error('Manager tickets error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   PUT /api/manager/leaves/:id
// @desc    Approve or reject a leave request from a direct report (final decision)
// @access  Private (Manager+)
router.put('/leaves/:id', verifyToken, isManager, async (req, res) => {
    try {
        const { status, remarks } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const appRes = await query(
            `SELECT * FROM leave_applications WHERE id = $1 AND reporting_manager_id = $2 AND status = 'pending'`,
            [req.params.id, req.user.id]
        );
        if (appRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Leave request not found or already decided' });
        }
        const leaveApp = appRes.rows[0];

        const result = await query(
            `UPDATE leave_applications 
            SET status = $1, approved_by = $2, approval_remarks = $3, updated_at = NOW() 
            WHERE id = $4 RETURNING *`,
            [status, req.user.id, remarks, req.params.id]
        );

        if (status === 'approved') {
            const start = new Date(leaveApp.start_date);
            const end = new Date(leaveApp.end_date);

            const holidayRows = await query(
                `SELECT to_char(date, 'YYYY-MM-DD') as d FROM holidays WHERE date BETWEEN $1 AND $2`,
                [leaveApp.start_date, leaveApp.end_date]
            );
            const holidays = new Set((holidayRows.rows || []).map(r => r.d));

            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dow = d.getDay();
                if (dow === 0 || dow === 6) continue;
                const dateStr = istDateString(d);
                if (holidays.has(dateStr)) continue;
                const existing = await query(
                    'SELECT id FROM attendance WHERE employee_id = $1 AND date = $2',
                    [leaveApp.employee_id, dateStr]
                );
                if (existing.rows.length === 0) {
                    await query(
                        `INSERT INTO attendance (employee_id, date, status, remarks) 
                        VALUES ($1, $2, 'absent', $3)`,
                        [leaveApp.employee_id, dateStr, 'On leave: ' + (remarks || leaveApp.reason || '')]
                    );
                }
            }
        }

        res.json({ success: true, leave: result.rows[0] });

        const lt = await query('SELECT name FROM leave_types WHERE id = $1', [leaveApp.leave_type_id]).catch(() => ({ rows: [] }));
        const typeName = (lt.rows[0] && lt.rows[0].name) || 'Leave';
        try {
            await sendToUser(leaveApp.employee_id, {
                title: status === 'approved' ? 'Leave Approved' : 'Leave Rejected',
                body: `Your ${typeName} request was ${status}`,
                url: '/pages/employee/leave.html'
            });
        } catch (e) { console.error('Push notify error:', e.message); }
    } catch (error) {
        console.error('Manager leave approve error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   PUT /api/manager/wfh/:id
// @desc    Approve or reject a WFH request from a direct report (final decision)
// @access  Private (Manager+)
router.put('/wfh/:id', verifyToken, isManager, async (req, res) => {
    try {
        const { status, remarks } = req.body;
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const appRes = await query(
            `SELECT * FROM wfh_requests WHERE id = $1 AND reporting_manager_id = $2 AND status = 'pending'`,
            [req.params.id, req.user.id]
        );
        if (appRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'WFH request not found or already decided' });
        }

        const result = await query(
            `UPDATE wfh_requests 
            SET status = $1, approved_by = $2, approval_remarks = $3, updated_at = NOW() 
            WHERE id = $4 RETURNING *`,
            [status, req.user.id, remarks, req.params.id]
        );

        res.json({ success: true, wfh: result.rows[0] });

        const wfhApp = appRes.rows[0];
        try {
            await sendToUser(wfhApp.employee_id, {
                title: status === 'approved' ? 'WFH Approved' : 'WFH Rejected',
                body: `Your work-from-home request was ${status}`,
                url: '/pages/employee/wfh.html'
            });
        } catch (e) { console.error('Push notify error:', e.message); }
    } catch (error) {
        console.error('Manager WFH approve error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   PUT /api/manager/tickets/:id
// @desc    Respond to / resolve a query from a direct report
// @access  Private (Manager+)
router.put('/tickets/:id', verifyToken, isManager, async (req, res) => {
    try {
        const { response, status } = req.body;
        if (!response && !status) {
            return res.status(400).json({ success: false, message: 'Response or status is required' });
        }

        const appRes = await query(
            `SELECT * FROM support_tickets WHERE id = $1 AND reporting_manager_id = $2 AND status IN ('open', 'in_progress')`,
            [req.params.id, req.user.id]
        );
        if (appRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket not found or already closed' });
        }

        const newStatus = ['resolved', 'closed', 'in_progress'].includes(status) ? status : 'in_progress';
        const result = await query(
            `UPDATE support_tickets 
            SET admin_response = COALESCE($1, admin_response), status = $2, responded_by = $3, 
            responded_at = NOW(), updated_at = NOW() 
            WHERE id = $4 RETURNING *`,
            [response || null, newStatus, req.user.id, req.params.id]
        );

        res.json({ success: true, ticket: result.rows[0] });

        const ticket = appRes.rows[0];
        try {
            await sendToUser(ticket.employee_id, {
                title: 'Ticket Response',
                body: `Your query "${ticket.subject}" was ${newStatus}`,
                url: '/pages/employee/tickets.html'
            });
        } catch (e) { console.error('Push notify error:', e.message); }
    } catch (error) {
        console.error('Manager ticket respond error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
