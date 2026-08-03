const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { query } = require('../config/database');
const { verifyToken, generateToken } = require('../middleware/auth');
const { validateLogin, collectFieldErrors } = require('../middleware/validation');
const { sendOTPEmail } = require('../services/email');
const { uploadBuffer } = require('../services/storage');
const { EDITABLE_FIELDS } = require('./profileUpdates');

const uploadProfile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { const allowed = /jpeg|jpg|png|gif/; const ext = allowed.test(path.extname(file.originalname).toLowerCase()); const mime = allowed.test(file.mimetype); cb(null, ext && mime); } });

// @route   POST /api/auth/login
// @desc    Login user (Admin/Employee)
// @access  Public
router.post('/login', validateLogin, async (req, res) => {
    try {
        const { employee_id, password, portal } = req.body;
        
        // Find user by employee ID or email
        const result = await query(
            `SELECT * FROM employees 
            WHERE (LOWER(employee_id) = LOWER($1) OR LOWER(email) = LOWER($1)) AND status = $2`,
            [employee_id, 'active']
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid Employee ID or password' 
            });
        }
        
        const user = result.rows[0];
        
        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid Employee ID or password' 
            });
        }

        // Portal role enforcement
        if (portal === 'admin') {
            if (user.role !== 'admin' && user.role !== 'hr') {
                return res.status(403).json({
                    success: false,
                    message: 'This account does not have Admin access. Use the Employee Portal.'
                });
            }
        } else if (portal === 'employee') {
            if (user.role === 'admin' || user.role === 'hr') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin accounts must sign in through the Admin Portal.'
                });
            }
        }
        
        // Generate token
        const token = generateToken(user);
        
        // Return user info (without password)
        const { password_hash, ...userWithoutPassword } = user;
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            must_change_password: user.must_change_password === 1 || user.must_change_password === true,
            user: userWithoutPassword
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during login' 
        });
    }
});


// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT e.*, d.name as department_name, des.name as designation_name, des.level as designation_level,
            rm.first_name || ' ' || rm.last_name as reporting_manager_name, rm.employee_id as reporting_manager_employee_id
            FROM employees e 
            LEFT JOIN departments d ON e.department_id = d.id 
            LEFT JOIN designations des ON e.designation_id = des.id 
            LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
            WHERE e.id = $1`,
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const user = result.rows[0];
        delete user.password_hash;
        
        res.json({
            success: true,
            user
        });
        
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', verifyToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        
        if (!current_password || !new_password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Current and new password are required' 
            });
        }
        
        if (new_password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'New password must be at least 6 characters' 
            });
        }
        
        // Get current password hash
        const result = await query(
            'SELECT password_hash FROM employees WHERE id = $1',
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        // Verify current password
        const isPasswordValid = await bcrypt.compare(
            current_password, 
            result.rows[0].password_hash
        );
        
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Current password is incorrect' 
            });
        }
        
        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(new_password, salt);
        
        // Update password and clear must_change_password flag
        await query(
            'UPDATE employees SET password_hash = $1, must_change_password = 0, updated_at = NOW() WHERE id = $2',
            [password_hash, req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
        
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// @route   POST /api/auth/set-password
// @desc    Set a new password on first login after admin reset (forced change)
// @access  Private
router.post('/set-password', verifyToken, async (req, res) => {
    try {
        const { new_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        const result = await query(
            'SELECT must_change_password FROM employees WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!(result.rows[0].must_change_password === 1 || result.rows[0].must_change_password === true)) {
            return res.status(400).json({ success: false, message: 'Password change is not required' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(new_password, salt);

        await query(
            'UPDATE employees SET password_hash = $1, must_change_password = 0, updated_at = NOW() WHERE id = $2',
            [password_hash, req.user.id]
        );

        res.json({ success: true, message: 'Password set successfully' });
    } catch (error) {
        console.error('Set password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', verifyToken, (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// @route   POST /api/auth/profile-photo
// @desc    Upload profile photo
// @access  Private
router.post('/profile-photo', verifyToken, uploadProfile.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        
        const ext = path.extname(req.file.originalname).toLowerCase();
        const fileName = `profile-${req.user.id}-${Date.now()}${ext}`;
        const photoUrl = await uploadBuffer('profile-photos', fileName, req.file.buffer, req.file.mimetype);
        
        await query(
            'UPDATE employees SET profile_photo = $1, updated_at = NOW() WHERE id = $2',
            [photoUrl, req.user.id]
        );
        
        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
        console.error('Profile photo upload error:', error.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/profile-request
// @desc    Submit profile change request(s) for admin approval
// @access  Private
router.post('/profile-request', verifyToken, async (req, res) => {
    try {
        const changes = req.body.changes || req.body;

        if (!changes || typeof changes !== 'object' || Object.keys(changes).length === 0) {
            return res.status(400).json({ success: false, message: 'No changes provided' });
        }

        const fieldErrors = collectFieldErrors(changes);
        if (fieldErrors.length > 0) {
            return res.status(400).json({ success: false, errors: fieldErrors });
        }

        const employeeResult = await query(
            `SELECT ${EDITABLE_FIELDS.join(', ')} FROM employees WHERE id = $1`,
            [req.user.id]
        );

        if (employeeResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const current = employeeResult.rows[0];
        const created = [];

        for (const [field, newValue] of Object.entries(changes)) {
            if (!EDITABLE_FIELDS.includes(field)) continue;

            const oldValue = current[field] != null ? String(current[field]) : '';
            const nextValue = newValue != null ? String(newValue) : '';

            if (oldValue === nextValue) continue;
            if (nextValue === '') continue;

            const result = await query(
                `INSERT INTO profile_update_requests (employee_id, field, old_value, new_value, status)
                VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
                [req.user.id, field, oldValue, nextValue]
            );
            created.push(result.rows[0]);
        }

        if (created.length === 0) {
            return res.json({ success: true, message: 'No changes to submit', requests: [] });
        }

        res.status(201).json({
            success: true,
            message: `${created.length} change request(s) submitted for admin approval`,
            requests: created
        });
    } catch (error) {
        console.error('Profile request error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/auth/profile-requests
// @desc    Get current user's profile update requests
// @access  Private
router.get('/profile-requests', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT r.*, e.first_name || ' ' || e.last_name as reviewer_name
            FROM profile_update_requests r
            LEFT JOIN employees e ON r.reviewed_by = e.id
            WHERE r.employee_id = $1
            ORDER BY r.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, requests: result.rows });
    } catch (error) {
        console.error('Get profile requests error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/auth/profile-request/:id/cancel
// @desc    Cancel a pending profile update request
// @access  Private
router.post('/profile-request/:id/cancel', verifyToken, async (req, res) => {
    try {
        const check = await query(
            'SELECT id FROM profile_update_requests WHERE id = $1 AND employee_id = $2 AND status = $3',
            [req.params.id, req.user.id, 'pending']
        );

        if (check.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Pending request not found' });
        }

        const result = await query(
            `UPDATE profile_update_requests SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 RETURNING id, status`,
            [req.params.id]
        );

        res.json({ success: true, message: 'Request cancelled', request: result.rows[0] });
    } catch (error) {
        console.error('Cancel profile request error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
