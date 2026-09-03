const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin, isEmployee } = require('../middleware/auth');

/**
 * GET /api/daily-work-counts
 * Get all daily work counts with optional filtering
 */
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { projectId, setId, employeeId, date, view } = req.query;
        let condition = '';
        let params = [];
        let paramCount = 0;
    
        if (projectId) {
            paramCount++;
            condition += ` AND pc.project_id = $${paramCount}`;
            params.push(projectId);
        }
        if (setId) {
            paramCount++;
            condition += ` AND pc.set_id = $${paramCount}`;
            params.push(setId);
        }
        if (employeeId) {
            paramCount++;
            condition += ` AND pc.employee_id = $${paramCount}`;
            params.push(employeeId);
        }
        if (date) {
            paramCount++;
            condition += ` AND pc.work_date = $${paramCount}`;
            params.push(date);
        }
    
        condition = condition.substring(5); // Remove leading " AND "
    
        const result = await query(
            `SELECT pc.id, pc.project_id, pc.set_id, pc.employee_id, pc.work_date, pc.daily_count,
             p.name as project_name, s.name as set_name,
             e.first_name, e.last_name, e.employee_id as emp_id
             FROM daily_work_counts pc
             JOIN projects p ON pc.project_id = p.id
             JOIN project_sets s ON pc.set_id = s.id
             JOIN employees e ON pc.employee_id = e.id
             WHERE ${condition}
             ORDER BY pc.work_date DESC, e.first_name, e.last_name`,
            params
        );
        res.json({ success: true, counts: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/daily-work-counts/employee/:employeeId
 * Get daily work counts for a specific employee
 */
router.get('/employee/:employeeId', verifyToken, isEmployee, async (req, res) => {
    try {
        const result = await query(
            `SELECT pc.id, pc.project_id, pc.set_id, pc.work_date, pc.daily_count,
             p.name as project_name, s.name as set_name
             FROM daily_work_counts pc
             JOIN projects p ON pc.project_id = p.id
             JOIN project_sets s ON pc.set_id = s.id
             WHERE pc.employee_id = $1
             ORDER BY pc.work_date DESC`,
            [req.params.employeeId]
        );
        res.json({ success: true, counts: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/daily-work-counts
 * Submit or update daily work count
 * - Creates new record if none exists for employee+project+set+date
 * - Updates existing record if one already exists (no duplicates)
 */
router.post('/', verifyToken, isEmployee, async (req, res) => {
    try {
        const { projectId, setId, workDate, dailyCount } = req.body;
        if (!projectId || !setId || !workDate || dailyCount === undefined) {
            return res.status(400).json({ success: false, message: 'Project ID, Set ID, work date, and count are required' });
        }
    
        // Check if record already exists for this employee+project+set+date
        const existing = await query(
            `SELECT id, daily_count FROM daily_work_counts 
             WHERE project_id = $1 AND set_id = $2 AND employee_id = $3 AND work_date = $4`,
            [projectId, setId, req.user.employeeId || req.user.id, workDate]
        );
    
        if (existing.rows.length > 0) {
            // Update existing record
            const result = await query(
                `UPDATE daily_work_counts SET daily_count = $1, updated_at = NOW() 
                 WHERE id = $2 
                 RETURNING id, project_id, set_id, employee_id, work_date, daily_count`,
                [dailyCount, existing.rows[0].id]
            );
            res.json({ 
                success: true, 
                updated: true,
                dailyCount: result.rows[0].daily_count,
                message: 'Daily work count updated successfully' 
            });
        } else {
            // Create new record
            // First verify employee is assigned to project
            const empCheck = await query(
                `SELECT id FROM project_employees WHERE project_id = $1 AND employee_id = $2`,
                [projectId, req.user.employeeId || req.user.id]
            );
            if (empCheck.rows.length === 0) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Employee is not assigned to this project' 
                });
            }
    
            // Verify set belongs to project
            const setCheck = await query(
                `SELECT id FROM project_sets WHERE project_id = $1 AND id = $2 AND status = 'active'`,
                [projectId, setId]
            );
            if (setCheck.rows.length === 0) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Set does not belong to this project or is not active' 
                });
            }
    
            // Verify date is within set range
            const dateCheck = await query(
                `SELECT start_date, end_date FROM project_sets WHERE id = $1`,
                [setId]
            );
            if (dateCheck.rows.length > 0) {
                const setStart = new Date(dateCheck.rows[0].start_date);
                const setEnd = new Date(dateCheck.rows[0].end_date);
                const subDate = new Date(workDate);
                
                if (subDate < setStart || subDate > setEnd) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Work date ${workDate} is outside the set period (${setStart.toISOString().split('T')[0]} - ${setEnd.toISOString().split('T')[0]})` 
                    });
                }
            }
    
            const result = await query(
                `INSERT INTO daily_work_counts (project_id, set_id, employee_id, work_date, daily_count) 
                 VALUES ($1, $2, $3, $4, $5) 
                 RETURNING id, project_id, set_id, employee_id, work_date, daily_count`,
                [projectId, setId, req.user.employeeId || req.user.id, workDate, dailyCount]
            );
            res.json({ 
                success: true, 
                created: true,
                dailyCount: result.rows[0].daily_count,
                message: 'Daily work count submitted successfully' 
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * PUT /api/daily-work-counts/:id
 * Update daily work count by ID
 */
router.put('/:id', verifyToken, isEmployee, async (req, res) => {
    try {
        const { dailyCount } = req.body;
        if (dailyCount === undefined) {
            return res.status(400).json({ success: false, message: 'Daily count is required' });
        }
    
        // Check ownership - employee can only update their own records
        const check = await query(
            `SELECT id, employee_id FROM daily_work_counts WHERE id = $1`,
            [req.params.id]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Daily work count not found' });
        }
    
        // Verify the employee owns this record
        if (check.rows[0].employee_id !== req.user.employeeId || check.rows[0].employee_id !== req.user.id) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized: You can only update your own daily work counts' 
            });
        }
    
        const result = await query(
            `UPDATE daily_work_counts SET daily_count = $1, updated_at = NOW() 
             WHERE id = $2 
             RETURNING id, project_id, set_id, employee_id, work_date, daily_count`,
            [dailyCount, req.params.id]
        );
        res.json({ 
            success: true, 
            dailyCount: result.rows[0].daily_count,
            message: 'Daily work count updated successfully' 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * DELETE /api/daily-work-counts/:id
 * Delete a daily work count record (admin only)
 */
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `DELETE FROM daily_work_counts WHERE id = $1 RETURNING id`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Daily work count not found' });
        }
        res.json({ success: true, message: 'Daily work count record deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/daily-work-counts/summary/:projectId/:setId
 * Get summary data for a project set (targets, achievements, etc.)
 */
router.get('/summary/:projectId/:setId', verifyToken, isAdmin, async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const setId = req.params.setId;
    
        // Get set details
        const setResult = await query(
            `SELECT ps.*, p.name as project_name, p.customer as project_customer,
             pe.count as project_employee_count
             FROM project_sets ps
             JOIN projects p ON ps.project_id = p.id
             LEFT JOIN (
                 SELECT project_id, COUNT(DISTINCT employee_id) as count
                 FROM project_employees
                 GROUP BY project_id
             ) pe ON ps.project_id = pe.project_id
             WHERE ps.id = $1`,
            [setId]
        );
    
        if (setResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Set not found' });
        }
    
        const setData = setResult.rows[0];
    
        // Get actual work counts for this set
        const countsResult = await query(
            `SELECT pc.employee_id, e.first_name, e.last_name, e.employee_id as emp_id,
             COALESCE(SUM(pc.daily_count), 0) as total_completed,
             COUNT(pc.id) as submission_days,
             COALESCE(SUM(pc.daily_count)::float / NULLIF($2, 0) * 100, 0) as achievement_percentage
             FROM daily_work_counts pc
             JOIN employees e ON pc.employee_id = e.id
             WHERE pc.set_id = $1
             GROUP BY pc.employee_id, e.first_name, e.last_name, e.employee_id`,
            [setId, setData.total_target]
        );
    
        // Get today's counts
        const today = new Date().toISOString().split('T')[0];
        const todayResult = await query(
            `SELECT pc.employee_id, e.first_name, e.last_name, e.employee_id as emp_id,
             pc.daily_count as today_count
             FROM daily_work_counts pc
             JOIN employees e ON pc.employee_id = e.id
             WHERE pc.set_id = $1 AND pc.work_date = $2`,
            [setId, today]
        );
    
        // Calculate totals
        let totalActual = 0;
        let totalTarget = 0;
        let submissionCount = 0;
    
        const counts = countsResult.rows.map(r => {
            totalActual += parseInt(r.total_completed) || 0;
            totalTarget += setData.total_target;
            submissionCount += parseInt(r.submission_days) || 0;
            return {
                employeeId: r.employee_id,
                empId: r.emp_id,
                name: `${r.first_name} ${r.last_name}`,
                totalCompleted: parseInt(r.total_completed) || 0,
                submissionDays: parseInt(r.submission_days) || 0,
                achievement: parseFloat(r.achievement_percentage).toFixed(1) || '0.0'
            };
        });
    
        res.json({ 
            success: true, 
            set: {
                id: setData.id,
                name: setData.name,
                projectName: setData.project_name,
                projectCustomer: setData.project_customer,
                totalTarget: setData.total_target,
                workingDays: setData.working_days,
                projectEmployeeCount: setData.project_employee_count || 0,
                targetPerEmployee: setData.total_target / (setData.project_employee_count || 1),
                dailyTargetPerEmployee: (setData.total_target / (setData.project_employee_count || 1)) / (setData.working_days || 1),
                dailyTeamTarget: (setData.total_target / (setData.project_employee_count || 1)) * (setData.working_days || 1),
                completionRate: setData.project_employee_count > 0 ? (totalActual / (setData.total_target * setData.project_employee_count * (setData.working_days || 1)) * 100).toFixed(1) : '0.0'
            },
            employees: counts,
            today: todayResult.rows,
            grandTotalActual: totalActual,
            grandTotalTarget: totalTarget,
            overallAchievement: totalTarget > 0 ? (totalActual / totalTarget * 100).toFixed(1) : '0.0'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;