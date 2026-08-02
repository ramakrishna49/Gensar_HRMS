const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT des.*, d.name as department_name 
            FROM designations des 
            LEFT JOIN departments d ON des.department_id = d.id 
            ORDER BY des.level, des.name`
        );
        res.json({ success: true, designations: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, level, department_id } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
        const result = await query(
            'INSERT INTO designations (name, level, department_id) VALUES ($1, $2, $3) RETURNING *',
            [name, level || 1, department_id || null]
        );
        res.status(201).json({ success: true, designation: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, level, department_id } = req.body;
        const result = await query(
            'UPDATE designations SET name = COALESCE($1, name), level = COALESCE($2, level), department_id = COALESCE($3, department_id) WHERE id = $4 RETURNING *',
            [name, level, department_id, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, designation: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query('DELETE FROM designations WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
