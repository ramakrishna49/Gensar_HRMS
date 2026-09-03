const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { runWithSchemaRepair, pgErrorResponse } = require('../utils/schemaRepair');
const { logAudit } = require('../utils/audit');

const q = (sql, params) => runWithSchemaRepair(() => query(sql, params));

// @route   GET /api/projects
// @desc    List all projects with employee count and computed targets
// @access  Admin
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q(
            `SELECT p.*,
                (SELECT COUNT(*)::int FROM project_employees pe WHERE pe.project_id = p.id AND pe.status = 'active') AS assigned_count
            FROM work_projects p
            WHERE p.status = 'active'
            ORDER BY p.name ASC`
        );

        const projects = result.rows.map(p => {
            const dailyTarget = p.working_days > 0
                ? Math.round((Number(p.weekly_target_per_employee) / p.working_days) * 100) / 100
                : 0;
            return {
                ...p,
                daily_target: dailyTarget,
                project_weekly_target: Math.round(Number(p.weekly_target_per_employee) * p.assigned_count * 100) / 100,
                project_daily_target: Math.round(dailyTarget * p.assigned_count * 100) / 100
            };
        });

        res.json({ success: true, projects });
    } catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/projects/all
// @desc    List all projects including inactive
// @access  Admin
router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q(
            `SELECT p.*,
                (SELECT COUNT(*)::int FROM project_employees pe WHERE pe.project_id = p.id AND pe.status = 'active') AS assigned_count
            FROM work_projects p
            ORDER BY p.status ASC, p.name ASC`
        );

        const projects = result.rows.map(p => {
            const dailyTarget = p.working_days > 0
                ? Math.round((Number(p.weekly_target_per_employee) / p.working_days) * 100) / 100
                : 0;
            return {
                ...p,
                daily_target: dailyTarget,
                project_weekly_target: Math.round(Number(p.weekly_target_per_employee) * p.assigned_count * 100) / 100,
                project_daily_target: Math.round(dailyTarget * p.assigned_count * 100) / 100
            };
        });

        res.json({ success: true, projects });
    } catch (error) {
        console.error('List all projects error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/projects/:id
// @desc    Get single project with assigned employees
// @access  Admin
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const projRes = await q('SELECT * FROM work_projects WHERE id = $1', [req.params.id]);
        if (projRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        const project = projRes.rows[0];
        const empRes = await q(
            `SELECT pe.id AS assignment_id, pe.assigned_at, pe.status AS assignment_status,
                e.id AS employee_id, e.first_name, e.last_name, e.employee_id AS emp_code,
                d.name AS department_name
            FROM project_employees pe
            JOIN employees e ON e.id = pe.employee_id
            LEFT JOIN departments d ON d.id = e.department_id
            WHERE pe.project_id = $1 AND pe.status = 'active'
            ORDER BY e.first_name`,
            [req.params.id]
        );

        const dailyTarget = project.working_days > 0
            ? Math.round((Number(project.weekly_target_per_employee) / project.working_days) * 100) / 100
            : 0;

        res.json({
            success: true,
            project: {
                ...project,
                daily_target: dailyTarget,
                project_weekly_target: Math.round(Number(project.weekly_target_per_employee) * empRes.rows.length * 100) / 100,
                project_daily_target: Math.round(dailyTarget * empRes.rows.length * 100) / 100
            },
            employees: empRes.rows
        });
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/projects
// @desc    Create a new project
// @access  Admin
router.post('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, customer_name, weekly_target_per_employee, working_days } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'Project name is required' });
        }
        if (!weekly_target_per_employee || Number(weekly_target_per_employee) < 0) {
            return res.status(400).json({ success: false, message: 'Weekly target per employee is required' });
        }
        const wd = parseInt(working_days) || 6;
        if (wd < 1 || wd > 7) {
            return res.status(400).json({ success: false, message: 'Working days must be between 1 and 7' });
        }

        const result = await q(
            `INSERT INTO work_projects (name, customer_name, weekly_target_per_employee, working_days)
            VALUES ($1, $2, $3, $4) RETURNING *`,
            [String(name).trim(), customer_name || null, Number(weekly_target_per_employee), wd]
        );

        logAudit({
            actorId: req.user.id,
            action: 'project.create',
            entityType: 'work_project',
            entityId: result.rows[0].id,
            details: { name: result.rows[0].name, customer_name },
            ip: req.ip
        });

        res.status(201).json({ success: true, project: result.rows[0] });
    } catch (error) {
        console.error('Create project error:', error);
        const errResp = pgErrorResponse(error);
        res.status(errResp.status).json({ success: false, message: errResp.message });
    }
});

// @route   PUT /api/projects/:id
// @desc    Update a project
// @access  Admin
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const { name, customer_name, weekly_target_per_employee, working_days, status } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: 'Project name is required' });
        }

        const result = await q(
            `UPDATE work_projects
            SET name = $1, customer_name = $2, weekly_target_per_employee = $3,
                working_days = $4, status = $5, updated_at = NOW()
            WHERE id = $6 RETURNING *`,
            [
                String(name).trim(),
                customer_name || null,
                Number(weekly_target_per_employee) || 0,
                parseInt(working_days) || 6,
                status || 'active',
                req.params.id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        logAudit({
            actorId: req.user.id,
            action: 'project.update',
            entityType: 'work_project',
            entityId: result.rows[0].id,
            details: { name: result.rows[0].name },
            ip: req.ip
        });

        res.json({ success: true, project: result.rows[0] });
    } catch (error) {
        console.error('Update project error:', error);
        const errResp = pgErrorResponse(error);
        res.status(errResp.status).json({ success: false, message: errResp.message });
    }
});

// @route   DELETE /api/projects/:id
// @desc    Soft-delete a project (set status=inactive)
// @access  Admin
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q(
            `UPDATE work_projects SET status = 'inactive', updated_at = NOW()
            WHERE id = $1 AND status = 'active' RETURNING id, name`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found or already inactive' });
        }

        logAudit({
            actorId: req.user.id,
            action: 'project.deactivate',
            entityType: 'work_project',
            entityId: result.rows[0].id,
            details: { name: result.rows[0].name },
            ip: req.ip
        });

        res.json({ success: true, message: 'Project deactivated' });
    } catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/projects/:id/employees
// @desc    Assign employees to a project (bulk)
// @access  Admin
router.post('/:id/employees', verifyToken, isAdmin, async (req, res) => {
    try {
        const { employee_ids } = req.body;
        if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'employee_ids array is required' });
        }

        const projRes = await q('SELECT id, name FROM work_projects WHERE id = $1', [req.params.id]);
        if (projRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Project not found' });
        }

        let added = 0;
        for (const empId of employee_ids) {
            const r = await q(
                `INSERT INTO project_employees (project_id, employee_id, status)
                VALUES ($1, $2, 'active')
                ON CONFLICT (project_id, employee_id)
                DO UPDATE SET status = 'active', assigned_at = NOW()
                RETURNING id`,
                [req.params.id, empId]
            );
            if (r.rows.length > 0) added++;
        }

        logAudit({
            actorId: req.user.id,
            action: 'project.employees_assign',
            entityType: 'work_project',
            entityId: req.params.id,
            details: { project: projRes.rows[0].name, employee_ids, count: added },
            ip: req.ip
        });

        res.json({ success: true, message: `${added} employee(s) assigned`, count: added });
    } catch (error) {
        console.error('Assign employees error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/projects/:id/employees/:empId
// @desc    Remove an employee from a project (historical counts preserved)
// @access  Admin
router.delete('/:id/employees/:empId', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q(
            `UPDATE project_employees SET status = 'removed'
            WHERE project_id = $1 AND employee_id = $2 AND status = 'active'
            RETURNING id`,
            [req.params.id, req.params.empId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Assignment not found' });
        }

        logAudit({
            actorId: req.user.id,
            action: 'project.employee_remove',
            entityType: 'project_employee',
            entityId: result.rows[0].id,
            details: { project_id: req.params.id, employee_id: req.params.empId },
            ip: req.ip
        });

        res.json({ success: true, message: 'Employee removed from project' });
    } catch (error) {
        console.error('Remove employee error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/projects/holidays/list
// @desc    List work holidays
// @access  Admin
router.get('/holidays/list', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q('SELECT * FROM work_holidays ORDER BY holiday_date ASC');
        res.json({ success: true, holidays: result.rows });
    } catch (error) {
        console.error('List work holidays error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/projects/holidays
// @desc    Add a work holiday
// @access  Admin
router.post('/holidays', verifyToken, isAdmin, async (req, res) => {
    try {
        const { holiday_date, holiday_name } = req.body;
        if (!holiday_date || !holiday_name || !String(holiday_name).trim()) {
            return res.status(400).json({ success: false, message: 'Date and holiday name are required' });
        }

        const result = await q(
            `INSERT INTO work_holidays (holiday_date, holiday_name)
            VALUES ($1, $2) RETURNING *`,
            [holiday_date, String(holiday_name).trim()]
        );

        logAudit({
            actorId: req.user.id,
            action: 'work_holiday.create',
            entityType: 'work_holiday',
            entityId: result.rows[0].id,
            details: { holiday_date, holiday_name },
            ip: req.ip
        });

        res.status(201).json({ success: true, holiday: result.rows[0] });
    } catch (error) {
        if (error && error.code === '23505') {
            return res.status(400).json({ success: false, message: 'A holiday already exists on this date' });
        }
        console.error('Create work holiday error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/projects/holidays/:id
// @desc    Remove a work holiday
// @access  Admin
router.delete('/holidays/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q('DELETE FROM work_holidays WHERE id = $1 RETURNING id, holiday_name', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Holiday not found' });
        }

        logAudit({
            actorId: req.user.id,
            action: 'work_holiday.delete',
            entityType: 'work_holiday',
            entityId: result.rows[0].id,
            details: { holiday_name: result.rows[0].holiday_name },
            ip: req.ip
        });

        res.json({ success: true, message: 'Holiday removed' });
    } catch (error) {
        console.error('Delete work holiday error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
