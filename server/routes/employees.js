const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { validateEmployee, collectFieldErrors } = require('../middleware/validation');
const { deleteFile, deleteFileByUrl } = require('../services/storage');

const MAIN_ADMIN_ID = 1;

async function activeAdminCount() {
    const r = await query(`SELECT COUNT(*) AS count FROM employees WHERE role = 'admin' AND status = 'active'`);
    return parseInt(r.rows[0].count, 10);
}

async function lastActiveAdminGuard(targetId) {
    const r = await query('SELECT role, status FROM employees WHERE id = $1', [targetId]);
    const target = r.rows[0];
    if (target && target.role === 'admin' && target.status === 'active' && await activeAdminCount() <= 1) {
        return 'Cannot remove the last active admin. You would lose all admin access.';
    }
    return null;
}

// @route   GET /api/employees
// @desc    Get all employees
// @access  Private (Admin/HR)
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { search, department, status, page = 1, limit = 10 } = req.query;
        let sqlQuery = `
            SELECT e.*, d.name as department_name, des.name as designation_name, des.level as designation_level,
            rm.first_name || ' ' || rm.last_name as reporting_manager_name, rm.employee_id as reporting_manager_employee_id
            FROM employees e 
            LEFT JOIN departments d ON e.department_id = d.id 
            LEFT JOIN designations des ON e.designation_id = des.id 
            LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
            WHERE 1=1 AND e.id != ${MAIN_ADMIN_ID}
        `;
        const params = [];
        let paramIndex = 1;
        
        if (search) {
            sqlQuery += ` AND (LOWER(e.first_name) LIKE LOWER($${paramIndex}) OR LOWER(e.last_name) LIKE LOWER($${paramIndex}) OR LOWER(e.email) LIKE LOWER($${paramIndex}) OR LOWER(e.employee_id) LIKE LOWER($${paramIndex}))`;
            params.push(`%${search}%`);
            paramIndex++;
        }
        
        if (department) {
            sqlQuery += ` AND e.department_id = $${paramIndex}`;
            params.push(department);
            paramIndex++;
        }
        
        if (status) {
            sqlQuery += ` AND e.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        // Count total
        const countResult = await query(
            sqlQuery.replace(/SELECT[\s\S]*?FROM employees/, 'SELECT COUNT(*) as count FROM employees'),
            params
        );
        const total = parseInt(countResult.rows[0].count);
        
        // Pagination
        const offset = (page - 1) * limit;
        sqlQuery += ` ORDER BY e.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);
        
        const result = await query(sqlQuery, params);
        
        // Remove password_hash from results
        const employees = result.rows.map(emp => {
            const { password_hash, ...employee } = emp;
            return employee;
        });
        
        res.json({
            success: true,
            employees,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Get employees error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/employees/:id
// @desc    Get single employee
// @access  Private (Admin/HR full access; others self or reporting-chain members only, PII stripped)
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const targetId = parseInt(req.params.id, 10);
        if (!Number.isInteger(targetId)) {
            return res.status(400).json({ success: false, message: 'Invalid employee id' });
        }

        const isAdminUser = req.user.role === 'admin';
        if (!isAdminUser) {
            const canView = await query(
                `WITH RECURSIVE chain AS (
                    SELECT id, reporting_manager_id FROM employees WHERE id = $1
                    UNION
                    SELECT e.id, e.reporting_manager_id FROM employees e JOIN chain c ON e.reporting_manager_id = c.id
                 )
                 SELECT 1 AS found FROM chain WHERE id = $2 LIMIT 1`,
                [targetId, req.user.id]
            );
            if (canView.rows.length === 0) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        const result = await query(
            `SELECT e.*, d.name as department_name, des.name as designation_name, des.level as designation_level,
            rm.first_name || ' ' || rm.last_name as reporting_manager_name, rm.employee_id as reporting_manager_employee_id
            FROM employees e 
            LEFT JOIN departments d ON e.department_id = d.id 
            LEFT JOIN designations des ON e.designation_id = des.id 
            LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
            WHERE e.id = $1`,
            [targetId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        
        const employee = result.rows[0];
        delete employee.password_hash;

        // Strip sensitive PII for non-admin viewers (self/team view still gets base profile)
        if (!isAdminUser) {
            const sensitiveFields = ['salary', 'pan_number', 'aadhaar_number', 'passport_number',
                'bank_name', 'bank_branch', 'bank_account', 'bank_ifsc'];
            sensitiveFields.forEach(f => delete employee[f]);
        }
        
        res.json({ success: true, employee });
        
    } catch (error) {
        console.error('Get employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/employees
// @desc    Create new employee
// @access  Private (Admin/HR)
router.post('/', verifyToken, isAdmin, validateEmployee, async (req, res) => {
    try {
        const fieldErrors = collectFieldErrors(req.body);
        if (fieldErrors.length > 0) {
            return res.status(400).json({ success: false, errors: fieldErrors });
        }
        const { 
            employee_id, first_name, last_name, email, phone, 
            password, department_id, designation_id, joining_date, 
            salary, role, address, date_of_birth, gender,
            permanent_address, languages_spoken, marital_status, personal_email,
            qualification, specialization, pan_number, aadhaar_number, passport_number,
            bank_name, bank_branch, bank_account, bank_ifsc, reporting_manager_id
        } = req.body;

        // Only the main Admin can create admin accounts.
        if (role === 'admin' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Only the main Admin can create admin accounts.' });
        }
        
        // Check if email exists
        const emailCheck = await query('SELECT id FROM employees WHERE email = $1', [email]);
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        
        // Generate random temp password if not provided
        const tempPassword = password || Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(tempPassword, salt);
        
        const result = await query(
            `INSERT INTO employees 
            (employee_id, first_name, last_name, email, phone, password_hash, 
             department_id, designation_id, joining_date, salary, role, address, 
             date_of_birth, gender, must_change_password,
             permanent_address, languages_spoken, marital_status, personal_email,
             qualification, specialization, pan_number, aadhaar_number, passport_number,
             bank_name, bank_branch, bank_account, bank_ifsc, reporting_manager_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) 
            RETURNING id, employee_id, first_name, last_name, email, role`,
            [
                employee_id, first_name, last_name, email, phone, password_hash,
                department_id || null, designation_id || null, joining_date,
                salary || null, role || 'employee', address || null,
                date_of_birth || null, gender || null,
                permanent_address || null, languages_spoken || null, marital_status || null, personal_email || null,
                qualification || null, specialization || null, pan_number || null, aadhaar_number || null, passport_number || null,
                bank_name || null, bank_branch || null, bank_account || null, bank_ifsc || null,
                reporting_manager_id || null
            ]
        );
        
        res.status(201).json({ success: true, employee: result.rows[0], temp_password: tempPassword });
        
    } catch (error) {
        console.error('Create employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   PUT /api/employees/:id
// @desc    Update employee
// @access  Private (Admin/HR)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const fieldErrors = collectFieldErrors(req.body);
        if (fieldErrors.length > 0) {
            return res.status(400).json({ success: false, errors: fieldErrors });
        }
        const { 
            first_name, last_name, email, phone, department_id, 
            designation_id, salary, role, status, address,
            joining_date, gender, date_of_birth, blood_group,
            emergency_contact, emergency_contact_name,
            permanent_address, languages_spoken, marital_status, personal_email,
            qualification, specialization, pan_number, aadhaar_number, passport_number,
            bank_name, bank_branch, bank_account, bank_ifsc, reporting_manager_id
        } = req.body;

        if (reporting_manager_id && parseInt(reporting_manager_id) === parseInt(req.params.id)) {
            return res.status(400).json({ success: false, message: 'An employee cannot be their own reporting manager' });
        }

        // Only the main Admin can manage admin accounts (promote to admin, or change an admin's role/status).
        if (req.user.role !== 'admin') {
            const cur = await query('SELECT role FROM employees WHERE id = $1', [req.params.id]);
            const curIsAdmin = cur.rows[0] && cur.rows[0].role === 'admin';
            if (role === 'admin' || (curIsAdmin && (role !== undefined || status !== undefined))) {
                return res.status(403).json({ success: false, message: 'Only the main Admin can manage admin accounts.' });
            }
        }

        // Last-active-admin guard: don't allow demoting/deactivating the final active admin.
        if ((role && role !== 'admin') || (status && status !== 'active')) {
            const guardError = await lastActiveAdminGuard(req.params.id);
            if (guardError) {
                return res.status(400).json({ success: false, message: guardError });
            }
        }

        // Cycle prevention: walk up the reporting chain from the candidate RM.
        // If it ever reaches the employee being edited, a cycle would be created.
        if (reporting_manager_id) {
            let currentId = parseInt(reporting_manager_id);
            const seen = new Set();
            let isCycle = false;
            while (currentId && !seen.has(currentId)) {
                if (currentId === parseInt(req.params.id)) {
                    isCycle = true;
                    break;
                }
                seen.add(currentId);
                const up = await query('SELECT reporting_manager_id FROM employees WHERE id = $1', [currentId]);
                currentId = up.rows[0] ? up.rows[0].reporting_manager_id : null;
            }
            if (isCycle) {
                return res.status(400).json({ success: false, message: 'Invalid reporting manager. This would create a reporting cycle.' });
            }
        }
        
        const result = await query(
            `UPDATE employees SET 
            first_name = COALESCE($1, first_name),
            last_name = COALESCE($2, last_name),
            email = COALESCE($3, email),
            phone = COALESCE($4, phone),
            department_id = COALESCE($5, department_id),
            designation_id = COALESCE($6, designation_id),
            salary = COALESCE($7, salary),
            role = COALESCE($8, role),
            status = COALESCE($9, status),
            address = COALESCE($10, address),
            joining_date = COALESCE($11, joining_date),
            gender = COALESCE($12, gender),
            date_of_birth = COALESCE($13, date_of_birth),
            blood_group = COALESCE($14, blood_group),
            emergency_contact = COALESCE($15, emergency_contact),
            emergency_contact_name = COALESCE($16, emergency_contact_name),
            permanent_address = COALESCE($17, permanent_address),
            languages_spoken = COALESCE($18, languages_spoken),
            marital_status = COALESCE($19, marital_status),
            personal_email = COALESCE($20, personal_email),
            qualification = COALESCE($21, qualification),
            specialization = COALESCE($22, specialization),
            pan_number = COALESCE($23, pan_number),
            aadhaar_number = COALESCE($24, aadhaar_number),
            passport_number = COALESCE($25, passport_number),
            bank_name = COALESCE($26, bank_name),
            bank_branch = COALESCE($27, bank_branch),
            bank_account = COALESCE($28, bank_account),
            bank_ifsc = COALESCE($29, bank_ifsc),
            reporting_manager_id = CASE WHEN $30::text = '' THEN NULL ELSE COALESCE($30::int, reporting_manager_id) END,
            updated_at = NOW()
            WHERE id = $31
            RETURNING id, employee_id, first_name, last_name, email, role`,
            [first_name, last_name, email, phone, department_id, designation_id, 
             salary, role, status, address, joining_date, gender, date_of_birth,
             blood_group, emergency_contact, emergency_contact_name,
             permanent_address, languages_spoken, marital_status, personal_email,
             qualification, specialization, pan_number, aadhaar_number, passport_number,
             bank_name, bank_branch, bank_account, bank_ifsc, reporting_manager_id, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        
        res.json({ success: true, employee: result.rows[0] });
        
    } catch (error) {
        console.error('Update employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/employees/:id/reset-password
// @desc    Admin resets an employee password and forces change on next login
// @access  Private (Admin/HR)
router.post('/:id/reset-password', verifyToken, isAdmin, async (req, res) => {
    try {
        const tempPassword = req.body.password || Math.random().toString(36).slice(-8) + 'A1';
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(tempPassword, salt);

        const result = await query(
            `UPDATE employees SET password_hash = $1, must_change_password = 1, updated_at = NOW()
            WHERE id = $2 RETURNING id, first_name, last_name`,
            [password_hash, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        res.json({ success: true, message: 'Password reset', temp_password: tempPassword, employee: result.rows[0] });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/employees/:id/pause
// @desc    Pause employee (blocks login, keeps all data)
// @access  Private (Admin)
router.post('/:id/pause', verifyToken, isAdmin, async (req, res) => {
    try {
        if (parseInt(req.params.id) === parseInt(req.user.id)) {
            return res.status(400).json({ success: false, message: 'You cannot pause your own account' });
        }
        const guardError = await lastActiveAdminGuard(req.params.id);
        if (guardError) {
            return res.status(400).json({ success: false, message: guardError });
        }
        const result = await query(
            `UPDATE employees SET status = 'paused', updated_at = NOW() 
            WHERE id = $1 RETURNING id`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        res.json({ success: true, message: 'Employee paused successfully' });
    } catch (error) {
        console.error('Pause employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/employees/:id/resume
// @desc    Resume a paused employee back to active
// @access  Private (Admin)
router.post('/:id/resume', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `UPDATE employees SET status = 'active', updated_at = NOW() 
            WHERE id = $1 AND status = 'paused' RETURNING id`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Employee is not paused' });
        }
        res.json({ success: true, message: 'Employee resumed successfully' });
    } catch (error) {
        console.error('Resume employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/employees/:id
// @desc    Delete employee (soft delete)
// @access  Private (Admin)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const guardError = await lastActiveAdminGuard(req.params.id);
        if (guardError) {
            return res.status(400).json({ success: false, message: guardError });
        }
        const result = await query(
            `UPDATE employees SET status = 'terminated', updated_at = NOW() 
            WHERE id = $1 RETURNING id`,
            [req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        
        res.json({ success: true, message: 'Employee terminated successfully' });
        
    } catch (error) {
        console.error('Delete employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/employees/:id/permanent
// @desc    Permanently delete an employee and ALL related data
// @access  Private (Admin)
router.delete('/:id/permanent', verifyToken, isAdmin, async (req, res) => {
    try {
        if (parseInt(req.params.id) === parseInt(req.user.id)) {
            return res.status(400).json({ success: false, message: 'You cannot permanently delete your own account' });
        }

        const guardError = await lastActiveAdminGuard(req.params.id);
        if (guardError) {
            return res.status(400).json({ success: false, message: guardError });
        }

        const empRes = await query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
        if (empRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        const employee = empRes.rows[0];

        // Collect uploaded files to remove afterwards
        const docRes = await query('SELECT file_name FROM documents WHERE employee_id = $1', [req.params.id]);
        const profilePhoto = employee.profile_photo;

        // Delete related data (cascade across all child tables)
        await query('DELETE FROM attendance_photos WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM attendance WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM leave_applications WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM payroll WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM documents WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM profile_update_requests WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM announcement_reads WHERE employee_id = $1', [req.params.id]);
        await query('DELETE FROM password_reset_otps WHERE email = $1', [employee.email]);
        await query('DELETE FROM employees WHERE id = $1', [req.params.id]);

        // Remove associated files from Supabase Storage
        try {
            if (profilePhoto) {
                await deleteFileByUrl(profilePhoto);
            }
            for (const d of docRes.rows) {
                if (d.file_name) {
                    await deleteFile('documents', d.file_name);
                }
            }
        } catch (e) {
            console.error('Permanent delete storage cleanup error:', e.message);
        }

        res.json({ success: true, message: 'Employee permanently deleted along with all their data' });
    } catch (error) {
        console.error('Permanent delete employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
