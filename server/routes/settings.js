const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.get('/company', verifyToken, async (req, res) => {
    try {
        const result = await query('SELECT * FROM companies LIMIT 1');
        const settings = await query('SELECT * FROM company_settings');
        const settingsMap = {};
        settings.rows.forEach(s => { settingsMap[s.setting_key] = s.setting_value; });
        res.json({ success: true, company: result.rows[0] || null, settings: settingsMap });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/company', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, email, phone, address, website, logo } = req.body;
        const result = await query(
            `UPDATE companies SET name = COALESCE($1, name), email = COALESCE($2, email), 
            phone = COALESCE($3, phone), address = COALESCE($4, address), website = COALESCE($5, website),
            logo = CASE WHEN $6::text = '' THEN NULL ELSE COALESCE($6, logo) END,
            updated_at = NOW() WHERE id = (SELECT id FROM companies LIMIT 1) RETURNING *`,
            [name, email, phone, address, website, logo]
        );
        res.json({ success: true, company: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/timing', verifyToken, isAdmin, async (req, res) => {
    try {
        const { start_time, end_time, grace_period, timezone } = req.body;
        const updates = [
            { key: 'office_start_time', value: start_time },
            { key: 'office_end_time', value: end_time },
            { key: 'late_grace_period', value: grace_period },
            { key: 'timezone', value: timezone }
        ];
        for (const u of updates) {
            if (u.value) {
                await query(
                    `INSERT INTO company_settings (setting_key, setting_value, updated_at) 
                    VALUES ($1, $2, NOW()) 
                    ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = NOW()`,
                    [u.key, u.value]
                );
            }
        }
        res.json({ success: true, message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
