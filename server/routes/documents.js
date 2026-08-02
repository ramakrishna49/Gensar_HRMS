const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/my', verifyToken, async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM documents WHERE employee_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, documents: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT d.*, e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
            FROM documents d
            JOIN employees e ON d.employee_id = e.id
            ORDER BY d.created_at DESC`
        );
        res.json({ success: true, documents: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        
        const { title, document_type } = req.body;
        const file_url = `/uploads/${req.file.filename}`;
        
        const result = await query(
            `INSERT INTO documents (employee_id, title, file_url, file_name, document_type, uploaded_by) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [req.user.id, title || req.file.originalname, file_url, req.file.filename, document_type, req.user.id]
        );
        
        res.status(201).json({ success: true, document: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/:id/download', verifyToken, async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM documents WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        
        const doc = result.rows[0];
        const filePath = path.join(__dirname, '../../uploads', doc.file_name);
        
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'File not found on server' });
        
        res.download(filePath, doc.title + path.extname(doc.file_name));
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM documents WHERE id = $1 AND employee_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id/admin', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            'DELETE FROM documents WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
