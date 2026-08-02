const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

// @route   GET /api/notifications/counts
// @desc    Get pending-action counts for the notification bell (admin)
// @access  Private (Admin)
router.get('/counts', verifyToken, isAdmin, async (req, res) => {
    try {
        const [pendingLeaves, pendingWfh, pendingProfileUpdates, announcementsUnread, pendingTickets] = await Promise.all([
            query("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'"),
            query("SELECT COUNT(*) as count FROM wfh_requests WHERE status = 'pending'"),
            query("SELECT COUNT(*) as count FROM profile_update_requests WHERE status = 'pending'"),
            query(
                `SELECT COUNT(*) as count FROM announcements a
                WHERE a.is_active = 1
                AND a.id NOT IN (SELECT announcement_id FROM announcement_reads WHERE employee_id = $1)`,
                [req.user.id]
            ),
            query("SELECT COUNT(*) as count FROM support_tickets WHERE status IN ('open', 'in_progress')")
        ]);
        res.json({
            success: true,
            counts: {
                pendingLeaves: parseInt(pendingLeaves.rows[0].count),
                pendingWfh: parseInt(pendingWfh.rows[0].count),
                pendingProfileUpdates: parseInt(pendingProfileUpdates.rows[0].count),
                announcementsUnread: parseInt(announcementsUnread.rows[0].count),
                pendingTickets: parseInt(pendingTickets.rows[0].count),
                total: parseInt(pendingLeaves.rows[0].count) + parseInt(pendingWfh.rows[0].count) + parseInt(pendingProfileUpdates.rows[0].count) + parseInt(announcementsUnread.rows[0].count) + parseInt(pendingTickets.rows[0].count)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/notifications/requests
// @desc    Latest pending employee requests (leave / WFH / queries) for the admin sidebar
// @access  Private (Admin)
router.get('/requests', verifyToken, isAdmin, async (req, res) => {
    try {
        const [leaves, wfh, tickets] = await Promise.all([
            query(
                `SELECT la.id, la.status, la.start_date, la.end_date, la.total_days, la.created_at,
                lt.name as leave_type_name,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM leave_applications la
                LEFT JOIN leave_types lt ON la.leave_type_id = lt.id
                JOIN employees e ON la.employee_id = e.id
                WHERE la.status = 'pending'
                ORDER BY la.created_at DESC LIMIT 8`
            ),
            query(
                `SELECT wr.id, wr.status, wr.start_date, wr.end_date, wr.total_days, wr.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM wfh_requests wr
                JOIN employees e ON wr.employee_id = e.id
                WHERE wr.status = 'pending'
                ORDER BY wr.created_at DESC LIMIT 8`
            ),
            query(
                `SELECT st.id, st.status, st.priority, st.subject, st.created_at,
                e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM support_tickets st
                JOIN employees e ON st.employee_id = e.id
                WHERE st.status IN ('open', 'in_progress')
                ORDER BY st.created_at DESC LIMIT 8`
            )
        ]);

        const feed = [
            ...leaves.rows.map(r => ({
                type: 'leave',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} applied ${r.leave_type_name}`,
                subtitle: `${r.emp_id} · ${r.start_date} to ${r.end_date} (${r.total_days} day${r.total_days > 1 ? 's' : ''})`,
                created_at: r.created_at,
                url: '/pages/admin/leave.html?status=pending'
            })),
            ...wfh.rows.map(r => ({
                type: 'wfh',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} requested WFH`,
                subtitle: `${r.emp_id} · ${r.start_date} to ${r.end_date} (${r.total_days} day${r.total_days > 1 ? 's' : ''})`,
                created_at: r.created_at,
                url: '/pages/admin/wfh.html?status=pending'
            })),
            ...tickets.rows.map(r => ({
                type: 'ticket',
                id: r.id,
                status: r.status,
                title: `${r.employee_name} raised a query`,
                subtitle: `${r.emp_id} · ${r.subject}`,
                created_at: r.created_at,
                url: '/pages/admin/tickets.html?status=open'
            }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);

        res.json({ success: true, feed });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
