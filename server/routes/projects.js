const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

/**
 * GET /api/projects
 * Get all projects
 */
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, customer, description, status, created_at 
             FROM projects 
             ORDER BY name`
        );
        res.json({ success: true, projects: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try { const { name, customer, description } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: 'Project name is required' });
        }
    
        const result = await query(
            `INSERT INTO projects (name, customer, description, status) 
             VALUES ($1, $2, $3, 'active') 
             RETURNING id, name, customer, description, status, created_at`,
            [name, customer || null, description || null]
        );
        res.json({ success: true, project: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/projects/:id
 * Get a single project by ID
 */
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, name, customer, description, status, created_at, updated_at 
             FROM projects WHERE id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        res.json({ success: true, project: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, customer, description, status } = req.body;
        const result = await query(
            `UPDATE projects SET name = $1, customer = $2, description = $3, status = $4, updated_at = NOW() 
             WHERE id = $5 
             RETURNING id, name, customer, description, status, created_at, updated_at`,
            [name, customer || null, description || null, status, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
        res.json({ success: true, project: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * DELETE /api/projects/:id
 * Delete/deactivate a project
 */
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        // Check if project has associated sets or employees
        const check = await query(
            `SELECT COUNT(*) as count FROM project_sets WHERE project_id = $1`,
            [req.params.id]
        );
        if (parseInt(check.rows[0].count) > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete project: it has associated sets. Deactivate instead.' 
            });
        }
        
        const result = await query(
            `DELETE FROM projects WHERE id = $1 RETURNING id, name`,
            [req.params.id]
        );
        res.json({ success: true, project: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/projects/:projectId/employees
 * Get employees assigned to a project
 */
router.get('/:projectId/employees', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email, e.phone, 
              e.role, e.status, e.department_id, d.name as department_name
             FROM project_employees pe
             JOIN employees e ON pe.employee_id = e.id
             LEFT JOIN departments d ON e.department_id = d.id
             WHERE pe.project_id = $1 AND e.role != 'admin'
             ORDER BY e.first_name, e.last_name`,
            [req.params.projectId]
        );
        res.json({ success: true, employees: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/projects/:projectId/employees
 * Assign employees to a project
 */
router.post('/:projectId/employees', verifyToken, isAdmin, async (req, res) => {
    try {
        const { employeeIds } = req.body;
        if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Employee IDs are required' });
        }
    
        // Check if project exists
        const projectCheck = await query(
            `SELECT id FROM projects WHERE id = $1`,
            [req.params.projectId]
        );
        if (projectCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
    
        // Assign employees (idempotent - uses ON CONFLICT pattern)
        const results = [];
        for (const empId of employeeIds) {
            const result = await query(
                `INSERT INTO project_employees (project_id, employee_id) 
                 VALUES ($1, $2) 
                 ON CONFLICT (project_id, employee_id) DO NOTHING 
                 RETURNING id, project_id, employee_id`,
                [req.params.projectId, empId]
            );
            results.push(result.rows[0]);
        }
    
        // Get the full updated employee list
        const employeeResult = await query(
            `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email, e.phone, 
              e.role, e.status, e.department_id, d.name as department_name
             FROM project_employees pe
             JOIN employees e ON pe.employee_id = e.id
             LEFT JOIN departments d ON e.department_id = d.id
             WHERE pe.project_id = $1 AND e.role != 'admin'
             ORDER BY e.first_name, e.last_name`,
            [req.params.projectId]
        );
    
        res.json({ 
            success: true, 
            assigned: results.filter(r => r.id),
            totalAssigned: employeeResult.rows.length,
            employees: employeeResult.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * DELETE /api/projects/:projectId/employees/:employeeId
 * Remove employee from project
 */
router.delete('/:projectId/employees/:employeeId', verifyToken, isAdmin, async (req, res) => {
    try {
        // Do NOT delete historical daily work count data
        const result = await query(
            `DELETE FROM project_employees WHERE project_id = $1 AND employee_id = $2 RETURNING employee_id`,
            [req.params.projectId, req.params.employeeId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Employee not assigned to project' });
        }
    
        res.json({ 
            success: true, 
            message: 'Employee removed from project successfully' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;