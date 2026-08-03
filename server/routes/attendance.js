const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { istDateString, istTimeString, istMonth, istYear } = require('../utils/date');

router.post('/check-in', verifyToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.status(400).json({ success: false, message: 'Attendance is not tracked for admin accounts' });
        }
        const today = istDateString();
        const now = istTimeString();
        const location = req.body.location || '';
        
        const existing = await query(
            'SELECT id FROM attendance WHERE employee_id = $1 AND date = $2',
            [req.user.id, today]
        );
        
        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Already checked in today' });
        }
        
        // Check if late based on company settings
        const settings = await query(
            `SELECT setting_key, setting_value FROM company_settings 
             WHERE setting_key IN ('office_start_time', 'late_grace_period')`
        );
        const settingsMap = {};
        settings.rows.forEach(s => { settingsMap[s.setting_key] = s.setting_value; });
        
        const officeStart = settingsMap['office_start_time'] || '09:30';
        const graceMins = parseInt(settingsMap['late_grace_period']) || 15;
        
        const startParts = officeStart.split(':').map(Number);
        const nowParts = now.split(':').map(Number);
        const nowMins = nowParts[0] * 60 + nowParts[1];
        const lateCutoff = startParts[0] * 60 + startParts[1] + graceMins;
        const halfDayCutoff = 12 * 60;
        
        let status;
        if (nowMins <= lateCutoff) {
            status = 'present';
        } else if (nowMins <= halfDayCutoff) {
            // Check if this would be the 3rd late this month (auto half-day rule)
            const monthStart = today.substring(0, 7) + '-01';
            const lateCount = await query(
                `SELECT COUNT(*) as count FROM attendance 
                WHERE employee_id = $1 AND date >= $2 AND date < $3 AND status = 'late'`,
                [req.user.id, monthStart, today]
            );
            const currentLateCount = parseInt(lateCount.rows[0].count);
            if (currentLateCount >= 3) {
                status = 'half-day';
            } else {
                status = 'late';
            }
        } else {
            status = 'half-day';
        }
        
        const result = await query(
            `INSERT INTO attendance (employee_id, date, check_in, status, check_in_location) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.user.id, today, now, status, location]
        );

        const attendance = result.rows[0];
        let has_photo = false;

        if (req.body.photo) {
            const photoData = req.body.photo;
            const m = photoData.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i);
            if (m) {
                const buf = Buffer.from(m[2], 'base64');
                if (buf.length <= 2 * 1024 * 1024) {
                    const token = crypto.randomBytes(32).toString('hex');
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                    await query(
                        `INSERT INTO attendance_photos (attendance_id, employee_id, photo, token, expires_at, type)
                        VALUES ($1, $2, $3, $4, $5, 'check_in')`,
                        [attendance.id, req.user.id, buf, token, expiresAt]
                    );
                    await query(
                        'UPDATE attendance SET photo_token = $1 WHERE id = $2',
                        [token, attendance.id]
                    );
                    attendance.photo_token = token;
                    has_photo = true;
                }
            }
        }

        res.json({ success: true, attendance, has_photo });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/check-out', verifyToken, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.status(400).json({ success: false, message: 'Attendance is not tracked for admin accounts' });
        }
        const today = istDateString();
        const now = istTimeString();
        const location = req.body.location || '';
        
        const checkIn = await query(
            'SELECT check_in FROM attendance WHERE employee_id = $1 AND date = $2 AND check_out IS NULL',
            [req.user.id, today]
        );
        
        if (checkIn.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No check-in found for today' });
        }
        
        let overtime = 0;
        const checkInTime = checkIn.rows[0].check_in;
        const officeEnd = '18:30:00';
        if (checkInTime && now > officeEnd) {
            const endParts = officeEnd.split(':').map(Number);
            const nowParts = now.split(':').map(Number);
            const endMins = endParts[0] * 60 + endParts[1];
            const nowMins = nowParts[0] * 60 + nowParts[1];
            overtime = Math.max(0, (nowMins - endMins) / 60);
        }
        
        const result = await query(
            `UPDATE attendance SET check_out = $1, overtime_hours = $2, check_out_location = $3
            WHERE employee_id = $4 AND date = $5 AND check_out IS NULL 
            RETURNING *`,
            [now, overtime, location, req.user.id, today]
        );

        let has_photo = false;

        if (req.body.photo) {
            const photoData = req.body.photo;
            const m = photoData.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i);
            if (m) {
                const buf = Buffer.from(m[2], 'base64');
                if (buf.length <= 2 * 1024 * 1024) {
                    const token = crypto.randomBytes(32).toString('hex');
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                    await query(
                        `INSERT INTO attendance_photos (attendance_id, employee_id, photo, token, expires_at, type)
                        VALUES ($1, $2, $3, $4, $5, 'check_out')`,
                        [result.rows[0].id, req.user.id, buf, token, expiresAt]
                    );
                    await query(
                        'UPDATE attendance SET photo_token_checkout = $1 WHERE id = $2',
                        [token, result.rows[0].id]
                    );
                    result.rows[0].photo_token_checkout = token;
                    has_photo = true;
                }
            }
        }

        res.json({ success: true, attendance: result.rows[0], has_photo });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/break-start', verifyToken, async (req, res) => {
    try {
        const today = istDateString();
        const now = istTimeString();

        const record = await query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [req.user.id, today]
        );

        if (record.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No check-in found today' });
        }

        if (record.rows[0].check_out) {
            return res.status(400).json({ success: false, message: 'Already checked out today' });
        }

        if (record.rows[0].break_start && !record.rows[0].break_end) {
            return res.status(400).json({ success: false, message: 'Break already started' });
        }

        const result = await query(
            `UPDATE attendance SET break_start = $1, break_end = NULL
            WHERE employee_id = $2 AND date = $3 RETURNING *`,
            [now, req.user.id, today]
        );

        res.json({ success: true, attendance: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/break-end', verifyToken, async (req, res) => {
    try {
        const today = istDateString();
        const now = istTimeString();

        const record = await query(
            'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2',
            [req.user.id, today]
        );

        if (record.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'No check-in found today' });
        }

        if (!record.rows[0].break_start) {
            return res.status(400).json({ success: false, message: 'Break not started yet' });
        }

        if (record.rows[0].break_end) {
            return res.status(400).json({ success: false, message: 'Break already ended' });
        }

        const existingLog = (() => {
            try { return JSON.parse(record.rows[0].break_log || '[]'); } catch { return []; }
        })();
        existingLog.push({ start: record.rows[0].break_start, end: now });

        const result = await query(
            `UPDATE attendance SET break_log = $1, break_start = NULL, break_end = NULL
            WHERE employee_id = $2 AND date = $3 RETURNING *`,
            [JSON.stringify(existingLog), req.user.id, today]
        );

        res.json({ success: true, attendance: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/mark-present', verifyToken, isAdmin, async (req, res) => {
    try {
        const { employee_id, date } = req.body;
        if (!employee_id || !date) {
            return res.status(400).json({ success: false, message: 'Employee ID and date are required' });
        }

        const settings = await query(
            `SELECT setting_key, setting_value FROM company_settings WHERE setting_key IN ('office_start_time')`
        );
        const officeStart = settings.rows.length > 0 ? settings.rows[0].setting_value : '09:30';

        const existing = await query(
            'SELECT id FROM attendance WHERE employee_id = $1 AND date = $2',
            [employee_id, date]
        );

        if (existing.rows.length > 0) {
            const result = await query(
                `UPDATE attendance SET status = 'present', check_in = $1, check_out = NULL,
                break_start = NULL, break_end = NULL, break_log = NULL, overtime_hours = 0,
                remarks = NULL, check_in_location = NULL
                WHERE employee_id = $2 AND date = $3 RETURNING *`,
                [officeStart, employee_id, date]
            );
            res.json({ success: true, attendance: result.rows[0], message: 'Marked as present' });
        } else {
            const result = await query(
                `INSERT INTO attendance (employee_id, date, check_in, status)
                VALUES ($1, $2, $3, 'present') RETURNING *`,
                [employee_id, date, officeStart]
            );
            res.json({ success: true, attendance: result.rows[0], message: 'Marked as present' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.post('/mark-absent', verifyToken, isAdmin, async (req, res) => {
    try {
        const { employee_id, date, remarks, status } = req.body;
        if (!employee_id || !date) {
            return res.status(400).json({ success: false, message: 'Employee ID and date are required' });
        }
        const newStatus = status || 'absent';
        if (newStatus !== 'absent') {
            await query(
                'DELETE FROM attendance WHERE employee_id = $1 AND date = $2',
                [employee_id, date]
            );
            return res.json({ success: true, message: 'Attendance reset' });
        }
        const existing = await query(
            'SELECT id FROM attendance WHERE employee_id = $1 AND date = $2',
            [employee_id, date]
        );
        if (existing.rows.length > 0) {
            const result = await query(
                `UPDATE attendance SET status = 'absent', check_in = NULL, check_out = NULL, 
                break_start = NULL, break_end = NULL, break_log = NULL, overtime_hours = 0,
                remarks = COALESCE($1, remarks)
                WHERE employee_id = $2 AND date = $3 RETURNING *`,
                [remarks, employee_id, date]
            );
            res.json({ success: true, attendance: result.rows[0], message: 'Marked as absent' });
        } else {
            const result = await query(
                `INSERT INTO attendance (employee_id, date, status, remarks) 
                VALUES ($1, $2, 'absent', $3) RETURNING *`,
                [employee_id, date, remarks]
            );
            res.json({ success: true, attendance: result.rows[0], message: 'Marked as absent' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/my', verifyToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sqlQuery = `SELECT a.id, a.employee_id, a.date, a.check_in, a.check_out, a.status,
                a.overtime_hours, a.remarks, a.created_at, a.break_start, a.break_end, a.break_log,
                a.check_in_location, a.check_out_location,
                CASE WHEN apci.id IS NOT NULL THEN 1 ELSE 0 END as has_photo_checkin,
                CASE WHEN apco.id IS NOT NULL THEN 1 ELSE 0 END as has_photo_checkout
            FROM attendance a
            LEFT JOIN attendance_photos apci ON apci.token = a.photo_token
            LEFT JOIN attendance_photos apco ON apco.token = a.photo_token_checkout
            WHERE a.employee_id = $1`;
        const params = [req.user.id];
        
        if (month && year) {
            sqlQuery += ' AND to_char(a.date, \'MM\') = $2 AND to_char(a.date, \'YYYY\') = $3';
            params.push(String(month).padStart(2, '0'), String(year));
        }
        
        sqlQuery += ' ORDER BY a.date DESC';
        const result = await query(sqlQuery, params);
        res.json({ success: true, attendance: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { date, month, year, department, limit } = req.query;
        let sqlQuery = `
            SELECT a.*, e.first_name, e.last_name, e.employee_id as emp_id, d.name as department_name
            FROM attendance a
            JOIN employees e ON a.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.role != 'admin'
        `;
        const params = [];
        let paramIndex = 1;
        
        if (date) {
            sqlQuery += ` AND a.date = $${paramIndex}`;
            params.push(date);
            paramIndex++;
        }
        
        if (month && year) {
            sqlQuery += ` AND to_char(a.date, 'MM') = $${paramIndex} AND to_char(a.date, 'YYYY') = $${paramIndex + 1}`;
            params.push(String(month).padStart(2, '0'), String(year));
            paramIndex += 2;
        }
        
        if (department) {
            sqlQuery += ` AND e.department_id = $${paramIndex}`;
            params.push(department);
            paramIndex++;
        }
        
        sqlQuery += ' ORDER BY a.date DESC, a.check_in DESC, e.first_name';
        if (limit) {
            sqlQuery += ` LIMIT $${paramIndex}`;
            params.push(parseInt(limit));
        }
        const result = await query(sqlQuery, params);
        res.json({ success: true, attendance: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/late-count', verifyToken, isAdmin, async (req, res) => {
    try {
        const month = String(parseInt(req.query.month) || istMonth()).padStart(2, '0');
        const year = String(parseInt(req.query.year) || istYear());
        const result = await query(
            `SELECT e.id, e.first_name, e.last_name, e.employee_id, 
            COUNT(a.id) as late_count
            FROM employees e
            LEFT JOIN attendance a ON a.employee_id = e.id 
                AND a.status = 'late'
                AND to_char(a.date, 'MM') = $1
                AND to_char(a.date, 'YYYY') = $2
            WHERE e.status = 'active' AND e.role != 'admin'
            GROUP BY e.id
            HAVING late_count > 0
            ORDER BY late_count DESC`,
            [month, year]
        );
        res.json({ success: true, month: parseInt(month), year: parseInt(year), employees: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/monthly', verifyToken, isAdmin, async (req, res) => {
    try {
        const month = parseInt(req.query.month) || istMonth();
        const year = parseInt(req.query.year) || istYear();
        const lastDay = new Date(year, month, 0).getDate();

        const employees = await query(
            `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.department_id, d.name as department_name
             FROM employees e
             LEFT JOIN departments d ON e.department_id = d.id
             WHERE e.status = $1 AND e.role != 'admin' ORDER BY e.first_name`,
            ['active']
        );

        const attendance = await query(
            `SELECT employee_id, date, check_in, check_out, status, check_in_location
             FROM attendance 
             WHERE to_char(date, 'MM') = $1 AND to_char(date, 'YYYY') = $2`,
            [String(month).padStart(2, '0'), String(year)]
        );

        const attMap = {};
        attendance.rows.forEach(a => {
            const day = new Date(a.date).getDate();
            if (!attMap[a.employee_id]) attMap[a.employee_id] = {};
            attMap[a.employee_id][day] = { check_in: a.check_in, check_out: a.check_out, status: a.status, check_in_location: a.check_in_location };
        });

        const matrix = {};
        const today = new Date();
        today.setHours(0,0,0,0);
        employees.rows.forEach(emp => {
            matrix[emp.id] = {};
            for (let d = 1; d <= lastDay; d++) {
                const date = new Date(year, month - 1, d);
                const dayOfWeek = date.getDay();
                if (date > today) {
                    matrix[emp.id][d] = { status: 'upcoming', check_in: null, check_out: null };
                } else if (dayOfWeek === 0) {
                    matrix[emp.id][d] = { status: 'weekoff', check_in: null, check_out: null };
                } else if (dayOfWeek === 6) {
                    // Saturday: week off, but a check-in makes it a working day
                    if (attMap[emp.id] && attMap[emp.id][d]) {
                        matrix[emp.id][d] = attMap[emp.id][d];
                    } else {
                        matrix[emp.id][d] = { status: 'weekoff', check_in: null, check_out: null };
                    }
                } else if (attMap[emp.id] && attMap[emp.id][d]) {
                    matrix[emp.id][d] = attMap[emp.id][d];
                } else {
                    matrix[emp.id][d] = { status: 'absent', check_in: null, check_out: null };
                }
            }
        });

        res.json({
            success: true,
            month,
            year,
            days: lastDay,
            employees: employees.rows,
            matrix
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/attendance/photo/:token
// @desc    Serve check-in photo once, then delete it (one-time view)
// @access  Admin/HR only
router.get('/photo/:token', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            'SELECT * FROM attendance_photos WHERE token = $1',
            [req.params.token]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Photo not found or already viewed' });
        }

        const photo = result.rows[0];

        if (new Date(photo.expires_at) < new Date()) {
            await query('DELETE FROM attendance_photos WHERE id = $1', [photo.id]);
            return res.status(404).json({ success: false, message: 'Photo has expired' });
        }

        const buf = Buffer.isBuffer(photo.photo) ? photo.photo : Buffer.from(photo.photo);

        await query(
            "UPDATE attendance_photos SET viewed = 1, viewed_at = NOW() WHERE id = $1",
            [photo.id]
        );
        await query('DELETE FROM attendance_photos WHERE id = $1', [photo.id]);

        res.set({
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'X-One-Time-View': '1'
        });
        res.send(buf);
    } catch (error) {
        console.error('Serve photo error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
