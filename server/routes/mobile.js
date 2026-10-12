const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth');

async function ensureDeviceTable() {
    await query(`CREATE TABLE IF NOT EXISTS mobile_devices (
        id SERIAL PRIMARY KEY,
        employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        fcm_token TEXT NOT NULL,
        platform VARCHAR(20) DEFAULT 'android',
        app_version VARCHAR(20),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_id, fcm_token)
    )`);
    await query(`CREATE INDEX IF NOT EXISTS idx_mobile_devices_employee ON mobile_devices(employee_id)`);
}

// @route   POST /api/mobile/register-device
// @desc    Register/refresh the FCM device token for push (Android app)
// @access  Private
router.post('/register-device', verifyToken, async (req, res) => {
    try {
        const { fcm_token, platform, app_version } = req.body || {};
        if (!fcm_token || String(fcm_token).length < 10) {
            return res.status(400).json({ success: false, message: 'Valid fcm_token required' });
        }
        await ensureDeviceTable();
        await query(
            `INSERT INTO mobile_devices (employee_id, fcm_token, platform, app_version, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (employee_id, fcm_token)
             DO UPDATE SET platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, updated_at = NOW()`,
            [req.user.id, String(fcm_token), platform || 'android', app_version || null]
        );
        res.json({ success: true, message: 'Device registered' });
    } catch (error) {
        console.error('Mobile register-device error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/mobile/unregister-device
// @desc    Remove an FCM device token (logout)
// @access  Private
router.post('/unregister-device', verifyToken, async (req, res) => {
    try {
        const { fcm_token } = req.body || {};
        if (!fcm_token) return res.status(400).json({ success: false, message: 'fcm_token required' });
        await ensureDeviceTable();
        await query('DELETE FROM mobile_devices WHERE employee_id = $1 AND fcm_token = $2', [req.user.id, String(fcm_token)]);
        res.json({ success: true, message: 'Device removed' });
    } catch (error) {
        console.error('Mobile unregister-device error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/mobile/app-config
// @desc    Minimum supported app version + API base info (forces Play Store update)
// @access  Public (version gate must work before login)
router.get('/app-config', (req, res) => {
    res.json({
        success: true,
        min_app_version: process.env.MIN_APP_VERSION || '1.0.0',
        latest_app_version: process.env.LATEST_APP_VERSION || '1.0.0',
        play_store_url: process.env.PLAY_STORE_URL || '',
        api_version: 'v1',
        fcm_configured: Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON)
    });
});

module.exports = router;
