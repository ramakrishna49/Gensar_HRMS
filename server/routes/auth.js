const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { query } = require('../config/database');
const { verifyToken, generateToken } = require('../middleware/auth');
const { validateRegistration, validateLogin, collectFieldErrors } = require('../middleware/validation');
const { sendOTPEmail } = require('../services/email');
const { EDITABLE_FIELDS } = require('./profileUpdates');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `profile-${req.user.id}-${Date.now()}${path.extname(file.originalname)}`)
});
const uploadProfile = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { const allowed = /jpeg|jpg|png|gif/; const ext = allowed.test(path.extname(file.originalname).toLowerCase()); const mime = allowed.test(file.mimetype); cb(null, ext && mime); } });

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


// @route   POST /api/auth/register
// @desc    Register new employee
// @access  Public (or Protected based on requirements)
router.post('/register', validateRegistration, async (req, res) => {
    try {
        const { 
            employee_id, 
            first_name, 
            last_name, 
            email, 
            phone, 
            password, 
            department_id, 
            designation_id, 
            joining_date, 
            salary,
            role 
        } = req.body;
        
        // Check if email already exists
        const emailCheck = await query(
            'SELECT id FROM employees WHERE email = $1',
            [email]
        );
        
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email already registered' 
            });
        }
        
        // Check if employee_id already exists
        if (employee_id) {
            const empIdCheck = await query(
                'SELECT id FROM employees WHERE employee_id = $1',
                [employee_id]
            );
            
            if (empIdCheck.rows.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Employee ID already exists' 
                });
            }
        }
        
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        
        // Generate employee_id if not provided
        const finalEmployeeId = employee_id || `EMP${Date.now().toString().slice(-6)}`;
        
        // Insert new employee
        const result = await query(
            `INSERT INTO employees 
            (employee_id, first_name, last_name, email, phone, password_hash, 
             department_id, designation_id, joining_date, salary, role) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id, employee_id, first_name, last_name, email, role`,
            [
                finalEmployeeId, 
                first_name, 
                last_name, 
                email, 
                phone || null, 
                password_hash,
                department_id || null, 
                designation_id || null, 
                joining_date, 
                salary || null,
                role || 'employee'
            ]
        );
        
        const newUser = result.rows[0];
        
        // Generate token
        const token = generateToken(newUser);
        
        res.status(201).json({
            success: true,
            message: 'Registration successful',
            token,
            user: newUser
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during registration' 
        });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT e.*, d.name as department_name, des.name as designation_name, des.level as designation_level 
            FROM employees e 
            LEFT JOIN departments d ON e.department_id = d.id 
            LEFT JOIN designations des ON e.designation_id = des.id 
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
        
        const photoUrl = `/uploads/profile-${req.user.id}-${Date.now()}${path.extname(req.file.originalname)}`;
        
        await query(
            'UPDATE employees SET profile_photo = $1, updated_at = NOW() WHERE id = $2',
            [photoUrl, req.user.id]
        );
        
        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
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
