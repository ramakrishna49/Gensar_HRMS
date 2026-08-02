const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

// @route   GET /api/notifications/counts
// @desc    Get pending-action counts for the notification bell (admin)
// @access  Private (Admin)
router.get('/counts', verifyToken, isAdmin, async (req, res) => {
    try {
        const [pendingLeaves, pendingProfileUpdates, announcementsUnread, pendingTickets] = await Promise.all([
            query("SELECT COUNT(*) as count FROM leave_applications WHERE status = 'pending'"),
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
                pendingProfileUpdates: parseInt(pendingProfileUpdates.rows[0].count),
                announcementsUnread: parseInt(announcementsUnread.rows[0].count),
                pendingTickets: parseInt(pendingTickets.rows[0].count),
                total: parseInt(pendingLeaves.rows[0].count) + parseInt(pendingProfileUpdates.rows[0].count) + parseInt(announcementsUnread.rows[0].count) + parseInt(pendingTickets.rows[0].count)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
