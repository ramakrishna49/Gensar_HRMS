const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { uploadBuffer, deleteFile, getStorageClient } = require('../services/storage');

router.get('/', verifyToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const result = await query(
                `SELECT d.*, e.first_name || ' ' || e.last_name as employee_name, e.employee_id as emp_id
                FROM documents d
                JOIN employees e ON d.employee_id = e.id
                ORDER BY d.created_at DESC`
            );
            return res.json({ success: true, documents: result.rows });
        }
        const result = await query(
            'SELECT * FROM documents WHERE employee_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, documents: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

const ALLOWED_MIME = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        }
        cb(null, true);
    }
});

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

router.post('/upload', verifyToken, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: 'File too large. Maximum size is 10 MB.' });
            }
            if (err instanceof multer.MulterError && err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ success: false, message: 'File type not allowed. Use PDF, images, Word, Excel, PowerPoint, CSV or text files.' });
            }
            return res.status(400).json({ success: false, message: 'Upload failed: ' + err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        
        const { title, document_type } = req.body;
        const cleanExt = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
        const fileName = `doc-${crypto.randomBytes(16).toString('hex')}${cleanExt}`;
        const file_url = await uploadBuffer('documents', fileName, req.file.buffer, req.file.mimetype, { public: false });
        
        const result = await query(
            `INSERT INTO documents (employee_id, title, file_url, file_name, document_type, uploaded_by) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [req.user.id, title || req.file.originalname, file_url, fileName, document_type, req.user.id]
        );
        
        res.status(201).json({ success: true, document: result.rows[0] });
    } catch (error) {
        console.error('Document upload error:', error.message);
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

        const isAdminUser = req.user.role === 'admin';
        let canAccess = isAdminUser || doc.employee_id === req.user.id;
        if (!canAccess && (req.user.role === 'manager' || req.user.role === 'team_lead')) {
            const teamCheck = await query(
                `WITH RECURSIVE chain AS (
                    SELECT id, reporting_manager_id FROM employees WHERE id = $1
                    UNION
                    SELECT e.id, e.reporting_manager_id FROM employees e JOIN chain c ON e.reporting_manager_id = c.id
                 )
                 SELECT 1 AS found FROM chain WHERE id = $2 LIMIT 1`,
                [doc.employee_id, req.user.id]
            );
            if (teamCheck.rows.length > 0) canAccess = true;
        }
        if (!canAccess) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        if (!doc.file_name) return res.status(404).json({ success: false, message: 'File not found' });
        
        const { data, error } = await getStorageClient().storage.from('documents').download(doc.file_name);
        if (error || !data) return res.status(404).json({ success: false, message: 'File not found on server' });
        
        const buf = Buffer.from(await data.arrayBuffer());
        const safeName = encodeURIComponent(doc.title + path.extname(doc.file_name));
        res.setHeader('Content-Type', data.type || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
        res.send(buf);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const doc = await query('SELECT * FROM documents WHERE id = $1 AND employee_id = $2', [req.params.id, req.user.id]);
        if (doc.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        const result = await query(
            'DELETE FROM documents WHERE id = $1 AND employee_id = $2 RETURNING id',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        await deleteFile('documents', doc.rows[0].file_name);
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.delete('/:id/admin', verifyToken, isAdmin, async (req, res) => {
    try {
        const doc = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        const result = await query(
            'DELETE FROM documents WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        await deleteFile('documents', doc.rows[0].file_name);
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
