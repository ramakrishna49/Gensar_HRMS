const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isManager } = require('../middleware/auth');

// @route   GET /api/notifications/counts
// @desc    Get pending-action counts for the notification bell
// @access  Private (Admin/HR sees all, Manager/Team Lead sees own team)
router.get('/counts', verifyToken, isManager, async (req, res) => {
    try {
        const isAdminRole = req.user.role === 'admin' || req.user.role === 'hr';
        const scopeClause = isAdminRole ? '' : ' AND reporting_manager_id = $1';
        const scopeParams = isAdminRole ? [] : [req.user.id];

        const [pendingLeaves, pendingWfh, pendingTickets, announcementsUnread, pendingProfileUpdates] = await Promise.all([
            query("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'" + scopeClause, scopeParams),
            query("SELECT COUNT(*) as count FROM wfh_requests WHERE status = 'pending'" + scopeClause, scopeParams),
            query("SELECT COUNT(*) as count FROM support_tickets WHERE status IN ('open', 'in_progress')" + scopeClause, scopeParams),
            query(
                `SELECT COUNT(*) as count FROM announcements a
                WHERE a.is_active = 1
                AND a.id NOT IN (SELECT announcement_id FROM announcement_reads WHERE employee_id = $1)`,
                [req.user.id]
            ),
            isAdminRole
                ? query("SELECT COUNT(*) as count FROM profile_update_requests WHERE status = 'pending'")
                : Promise.resolve({ rows: [{ count: '0' }] })
        ]);

        const counts = {
            pendingLeaves: parseInt(pendingLeaves.rows[0].count),
            pendingWfh: parseInt(pendingWfh.rows[0].count),
            pendingProfileUpdates: parseInt(pendingProfileUpdates.rows[0].count),
            announcementsUnread: parseInt(announcementsUnread.rows[0].count),
            pendingTickets: parseInt(pendingTickets.rows[0].count)
        };
        counts.total = counts.pendingLeaves + counts.pendingWfh + counts.pendingProfileUpdates + counts.announcementsUnread + counts.pendingTickets;

        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/notifications/requests
// @desc    Latest pending employee requests (leave / WFH / queries) for the notification bell
// @access  Private (Admin/HR sees all, Manager/Team Lead sees own team)
router.get('/requests', verifyToken, isManager, async (req, res) => {
    try {
        const isAdminRole = req.user.role === 'admin' || req.user.role === 'hr';

        let leaveUrl, wfhUrl, ticketUrl;
        let leavesQuery, wfhQuery, ticketsQuery, profilesQuery = null;

        if (isAdminRole) {
            leaveUrl = '/pages/admin/leave.html?status=pending';
            wfhUrl = '/pages/admin/wfh.html?status=pending';
            ticketUrl = '/pages/admin/tickets.html?status=open';
            leavesQuery = {
                text: `SELECT la.id, la.status, la.start_date, la.end_date, la.total_days, la.created_at,
                lt.name as leave_type_name,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM leave_applications la
                LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
                JOIN employees e ON la.employee_id = e.id
                WHERE la.status = 'pending'
                ORDER BY la.created_at DESC LIMIT 8`,
                values: []
            };
            wfhQuery = {
                text: `SELECT wr.id, wr.status, wr.start_date, wr.end_date, wr.total_days, wr.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM wfh_requests wr
                JOIN employees e ON wr.employee_id = e.id
                WHERE wr.status = 'pending'
                ORDER BY wr.created_at DESC LIMIT 8`,
                values: []
            };
            ticketsQuery = {
                text: `SELECT st.id, st.status, st.priority, st.subject, st.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM support_tickets st
                JOIN employees e ON st.employee_id = e.id
                WHERE st.status IN ('open', 'in_progress')
                ORDER BY st.created_at DESC LIMIT 8`,
                values: []
            };
            profilesQuery = {
                text: `SELECT r.id, r.status, r.field, r.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM profile_update_requests r
                JOIN employees e ON r.employee_id = e.id
                WHERE r.status = 'pending'
                ORDER BY r.created_at DESC LIMIT 8`,
                values: []
            };
        } else {
            leaveUrl = '/pages/manager/my-team.html';
            wfhUrl = '/pages/manager/my-team.html';
            ticketUrl = '/pages/manager/my-team.html';
            leavesQuery = {
                text: `SELECT la.id, la.status, la.start_date, la.end_date, la.total_days, la.created_at,
                lt.name as leave_type_name,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM leave_applications la
                LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
                JOIN employees e ON la.employee_id = e.id
                WHERE la.status = 'pending' AND la.reporting_manager_id = $1
                ORDER BY la.created_at DESC LIMIT 8`,
                values: [req.user.id]
            };
            wfhQuery = {
                text: `SELECT wr.id, wr.status, wr.start_date, wr.end_date, wr.total_days, wr.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM wfh_requests wr
                JOIN employees e ON wr.employee_id = e.id
                WHERE wr.status = 'pending' AND wr.reporting_manager_id = $1
                ORDER BY wr.created_at DESC LIMIT 8`,
                values: [req.user.id]
            };
            ticketsQuery = {
                text: `SELECT st.id, st.status, st.priority, st.subject, st.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM support_tickets st
                JOIN employees e ON st.employee_id = e.id
                WHERE st.status IN ('open', 'in_progress') AND st.reporting_manager_id = $1
                ORDER BY st.created_at DESC LIMIT 8`,
                values: [req.user.id]
            };
        }

        const [leaves, wfh, tickets, profiles] = await Promise.all([
            query(leavesQuery.text, leavesQuery.values),
            query(wfhQuery.text, wfhQuery.values),
            query(ticketsQuery.text, ticketsQuery.values),
            profilesQuery ? query(profilesQuery.text, profilesQuery.values) : Promise.resolve({ rows: [] })
        ]);

        const feed = [
            ...leaves.rows.map(r => ({
                type: 'leave',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} applied ${r.leave_type_name}`,
                subtitle: `${r.emp_id} · ${r.start_date} to ${r.end_date} (${r.total_days} day${r.total_days > 1 ? 's' : ''})`,
                created_at: r.created_at,
                url: leaveUrl
            })),
            ...wfh.rows.map(r => ({
                type: 'wfh',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} requested WFH`,
                subtitle: `${r.emp_id} · ${r.start_date} to ${r.end_date} (${r.total_days} day${r.total_days > 1 ? 's' : ''})`,
                created_at: r.created_at,
                url: wfhUrl
            })),
            ...tickets.rows.map(r => ({
                type: 'ticket',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} raised a query`,
                subtitle: `${r.emp_id} · ${r.subject}`,
                created_at: r.created_at,
                url: ticketUrl
            })),
            ...profiles.rows.map(r => ({
                type: 'profile',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} requested profile update`,
                subtitle: `${r.emp_id} · ${r.field}`,
                created_at: r.created_at,
                url: '/pages/admin/employees.html'
            }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);

        res.json({ success: true, feed });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
