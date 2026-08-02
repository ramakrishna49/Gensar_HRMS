const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        const { year } = req.query;
        let sqlQuery = 'SELECT * FROM holidays WHERE is_active = 1';
        const params = [];
        
        if (year) {
            sqlQuery += " AND strftime('%Y', date) = $1";
            params.push(year);
        }
        
        sqlQuery += ' ORDER BY date';
        const result = await query(sqlQuery, params);
        res.json({ success: true, holidays: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, date, description } = req.body;
        if (!name || !date) return res.status(400).json({ success: false, message: 'Name and date required' });
        
        const result = await query(
            'INSERT INTO holidays (name, date, description) VALUES ($1, $2, $3) RETURNING *',
            [name, date, description]
        );
        res.status(201).json({ success: true, holiday: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, date, description } = req.body;
        const result = await query(
            'UPDATE holidays SET name = COALESCE($1, name), date = COALESCE($2, date), description = COALESCE($3, description) WHERE id = $4 RETURNING *',
            [name, date, description, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, holiday: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query('DELETE FROM holidays WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
