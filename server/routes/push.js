const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth');

// @route   GET /api/push/vapid-public-key
// @desc    Public VAPID key for the client to subscribe
// @access  Private
router.get('/vapid-public-key', verifyToken, (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({ success: false, message: 'Push notifications are not configured' });
    }
    res.json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY });
});

// @route   POST /api/push/subscribe
// @desc    Save the browser push subscription for the logged-in user
// @access  Private
router.post('/subscribe', verifyToken, async (req, res) => {
    try {
        const { subscription } = req.body;
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, message: 'Valid subscription required' });
        }
        const result = await query(
            `INSERT INTO push_subscriptions (employee_id, endpoint, subscription, user_agent)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint)
            DO UPDATE SET employee_id = EXCLUDED.employee_id,
                subscription = EXCLUDED.subscription,
                user_agent = EXCLUDED.user_agent,
                updated_at = NOW()
            RETURNING id`,
            [req.user.id, subscription.endpoint, JSON.stringify(subscription), req.headers['user-agent'] || null]
        );
        res.json({ success: true, subscription_id: result.rows[0].id });
    } catch (error) {
        console.error('Push subscribe error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/push/unsubscribe
// @desc    Remove a push subscription
// @access  Private
router.post('/unsubscribe', verifyToken, async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) {
            return res.status(400).json({ success: false, message: 'Endpoint required' });
        }
        await query(
            'DELETE FROM push_subscriptions WHERE employee_id = $1 AND endpoint = $2',
            [req.user.id, endpoint]
        );
        res.json({ success: true, message: 'Unsubscribed' });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
