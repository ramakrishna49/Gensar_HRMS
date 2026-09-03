const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

/**
 * GET /api/project-sets/single/:id
 * Get a single set by ID (MUST be before /:projectId to avoid route conflict)
 * Accessible to employees assigned to the project
 */
router.get('/single/:id', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT ps.*, p.name as project_name, p.customer as project_customer,
             (
                 SELECT COUNT(*) FROM employees e
                 JOIN project_employees pe ON e.id = pe.employee_id
                 WHERE pe.project_id = ps.project_id
             ) as project_employee_count,
             (
                 SELECT COUNT(*) FROM daily_work_counts dc
                 WHERE dc.set_id = ps.id
             ) as submission_count
             FROM project_sets ps
             JOIN projects p ON ps.project_id = p.id
             WHERE ps.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Set not found' });
        }
        res.json({ success: true, set: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/project-sets/:projectId
 * Get all sets for a project
 */
router.get('/:projectId', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `SELECT ps.id, ps.name, ps.start_date, ps.end_date, ps.total_target, ps.status, ps.working_days,
             pe.count as assigned_employees,
             (
                 SELECT COUNT(*) FROM daily_work_counts dc
                 WHERE dc.set_id = ps.id
             ) as submission_count
             FROM project_sets ps
             LEFT JOIN (
                 SELECT set_id, COUNT(DISTINCT employee_id) as count
                 FROM daily_work_counts
                 GROUP BY set_id
             ) pe ON ps.id = pe.set_id
             WHERE ps.project_id = $1
             ORDER BY ps.name`,
            [req.params.projectId]
        );
        res.json({ success: true, sets: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/project-sets/:projectId
 * Create a new set for a project
 */
router.post('/:projectId', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, start_date, end_date, total_target } = req.body;
        if (!name || !start_date || !end_date || total_target === undefined) {
            return res.status(400).json({ success: false, message: 'Set name, start_date, end_date, and total_target are required' });
        }
    
        const projectCheck = await query(`SELECT id FROM projects WHERE id = $1`, [req.params.projectId]);
        if (projectCheck.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }
    
        const workingDays = calculateWorkingDays(start_date, end_date);
    
        const result = await query(
            `INSERT INTO project_sets (project_id, name, start_date, end_date, total_target, working_days, status) 
             VALUES ($1, $2, $3, $4, $5, $6, 'active') 
             RETURNING id, project_id, name, start_date, end_date, total_target, working_days, status`,
            [req.params.projectId, name, start_date, end_date, total_target, workingDays]
        );
    
        res.json({ success: true, set: result.rows[0], workingDays });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * Helper function: Calculate working days between two dates (excluding Sundays)
 */
function calculateWorkingDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    let workingDays = 0;
    const current = new Date(start);
    
    while (current <= end) {
        // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const day = current.getDay();
        if (day !== 0) { // Exclude Sunday
            workingDays++;
        }
        current.setDate(current.getDate() + 1);
    }
    
    return workingDays;
}

module.exports = router;