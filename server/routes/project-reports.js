const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { runWithSchemaRepair, hasColumn } = require('../utils/schemaRepair');
const { buildReportWorkbook, sendWorkbook } = require('../utils/excel');

const q = (sql, params) => runWithSchemaRepair(() => query(sql, params));

/**
 * GET /api/project-reports
 * Get project reports with daily/weekly/monthly views
 * Query params: view, date, startDate, endDate, month, year, projectId, setId, employeeId
 */
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const { view, date, startDate, endDate, month, year, projectId, setId, employeeId } = req.query;

        if (!view || !['daily', 'weekly', 'monthly'].includes(view)) {
            return res.status(400).json({ success: false, message: 'View must be daily, weekly, or monthly' });
        }

        const hasDeletedAt = await hasColumn('project_sets', 'deleted_at');

        // Ensure client column exists (safe migration on first use)
        try {
            await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client VARCHAR(255)`);
            await q(`UPDATE projects SET client = customer WHERE client IS NULL AND customer IS NOT NULL`);
        } catch (e) { /* column may already exist */ }

        let dateFilter = '';
        let dateParams = [];
        let paramOffset = 0;

        if (view === 'daily') {
            if (!date) return res.status(400).json({ success: false, message: 'Date is required for daily view' });
            dateFilter = `AND dwc.work_date = $${++paramOffset}`;
            dateParams.push(date);
        } else if (view === 'weekly') {
            if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'startDate and endDate required for weekly view' });
            dateFilter = `AND dwc.work_date >= $${++paramOffset} AND dwc.work_date <= $${++paramOffset}`;
            dateParams.push(startDate, endDate);
        } else if (view === 'monthly') {
            if (!month || !year) return res.status(400).json({ success: false, message: 'month and year required for monthly view' });
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            dateFilter = `AND dwc.work_date >= $${++paramOffset} AND dwc.work_date <= $${++paramOffset}`;
            dateParams.push(monthStart, monthEnd);
        }

        let projectFilter = '';
        if (projectId && projectId !== 'all') {
            projectFilter = `AND pe.project_id = $${++paramOffset}`;
            dateParams.push(projectId);
        }

        let setFilter = '';
        if (setId && setId !== 'all') {
            setFilter = `AND ps.id = $${++paramOffset}`;
            dateParams.push(setId);
        }

        let employeeFilter = '';
        if (employeeId && employeeId !== 'all') {
            employeeFilter = `AND pe.employee_id = $${++paramOffset}`;
            dateParams.push(employeeId);
        }

        // Get all projects with their sets and employees
        const projectsQuery = `
            SELECT DISTINCT p.id, p.name, COALESCE(p.client, p.customer) as client, p.status
            FROM projects p
            JOIN project_employees pe ON p.id = pe.project_id
            JOIN project_sets ps ON ps.project_id = p.id AND ps.status = 'active' ${hasDeletedAt ? 'AND ps.deleted_at IS NULL' : ''}
            WHERE p.status = 'active'
            ${projectFilter}
            ORDER BY p.name
        `;

        const projectsResult = await q(projectsQuery, dateParams);
        const projects = projectsResult.rows;

        const reports = [];

        for (const project of projects) {
            // Get sets for this project
            const setsQuery = `
                SELECT ps.id, ps.name, ps.total_target, ps.working_days, ps.start_date, ps.end_date
                FROM project_sets ps
                WHERE ps.project_id = $1 AND ps.status = 'active' ${hasDeletedAt ? 'AND ps.deleted_at IS NULL' : ''}
                ORDER BY ps.name
            `;
            const setsResult = await q(setsQuery, [project.id]);
            const sets = setsResult.rows;

            const projectSets = [];

            for (const set of sets) {
                // Get employees assigned to this project
                const empQuery = `
                    SELECT e.id, e.first_name, e.last_name, e.employee_id as emp_id
                    FROM project_employees pe
                    JOIN employees e ON pe.employee_id = e.id
                    WHERE pe.project_id = $1 AND e.role != 'admin'
                    ORDER BY e.first_name, e.last_name
                `;
                const empResult = await q(empQuery, [project.id]);
                const employees = empResult.rows;

                const empCount = employees.length || 1;
                const workingDays = set.working_days || 1;
                const targetPerEmployee = Math.ceil(set.total_target / empCount);
                const dailyTargetPerEmployee = Math.ceil(set.total_target / empCount / workingDays);

                const employeeData = [];

                for (const emp of employees) {
                    let actualCounts = {};
                    let totalActual = 0;

                    if (view === 'daily') {
                        const countQuery = `
                            SELECT COALESCE(SUM(dwc.daily_count), 0) as count
                            FROM daily_work_counts dwc
                            WHERE dwc.set_id = $1 AND dwc.employee_id = $2 ${dateFilter}
                        `;
                        const countResult = await q(countQuery, [set.id, emp.id, ...dateParams]);
                        actualCounts.today = parseInt(countResult.rows[0].count) || 0;
                        totalActual = actualCounts.today;
                    } else if (view === 'weekly') {
                        // Get counts for each day of the week
                        const countQuery = `
                            SELECT dwc.work_date, dwc.daily_count
                            FROM daily_work_counts dwc
                            WHERE dwc.set_id = $1 AND dwc.employee_id = $2 ${dateFilter}
                            ORDER BY dwc.work_date
                        `;
                        const countResult = await q(countQuery, [set.id, emp.id, ...dateParams]);
                        countResult.rows.forEach(r => {
                            const dayKey = new Date(r.work_date).toISOString().split('T')[0];
                            actualCounts[dayKey] = parseInt(r.daily_count) || 0;
                            totalActual += actualCounts[dayKey];
                        });
                    } else if (view === 'monthly') {
                        // Get counts for each day of the month
                        const countQuery = `
                            SELECT dwc.work_date, dwc.daily_count
                            FROM daily_work_counts dwc
                            WHERE dwc.set_id = $1 AND dwc.employee_id = $2 ${dateFilter}
                            ORDER BY dwc.work_date
                        `;
                        const countResult = await q(countQuery, [set.id, emp.id, ...dateParams]);
                        countResult.rows.forEach(r => {
                            const dayKey = new Date(r.work_date).toISOString().split('T')[0];
                            actualCounts[dayKey] = parseInt(r.daily_count) || 0;
                            totalActual += actualCounts[dayKey];
                        });
                    }

                    const achievement = set.total_target > 0 ? (totalActual / targetPerEmployee * 100) : 0;
                    const status = achievement >= 100 ? 'ACHIEVED' : 'BELOW';

                    employeeData.push({
                        employee: emp,
                        actualCounts,
                        totalActual,
                        achievement: parseFloat(achievement.toFixed(1)),
                        status
                    });
                }

                // Set totals
                const setTotalActual = employeeData.reduce((sum, e) => sum + e.totalActual, 0);
                const setTotalTarget = set.total_target;
                const setOverallAchievement = setTotalTarget > 0 ? parseFloat((setTotalActual / setTotalTarget * 100).toFixed(1)) : 0;

                projectSets.push({
                    set: {
                        id: set.id,
                        name: set.name,
                        totalTarget: set.total_target,
                        workingDays: set.working_days,
                        targetPerEmployee,
                        dailyTargetPerEmployee,
                        startDate: set.start_date,
                        endDate: set.end_date
                    },
                    employees: employeeData,
                    setTotalActual,
                    setTotalTarget,
                    setOverallAchievement
                });
            }

            // Project totals
            const projectTotalActual = projectSets.reduce((sum, s) => sum + s.setTotalActual, 0);
            const projectTotalTarget = projectSets.reduce((sum, s) => sum + s.setTotalTarget, 0);

            reports.push({
                project: {
                    id: project.id,
                    name: project.name,
                    client: project.client,
                    status: project.status
                },
                sets: projectSets,
                projectTotalActual,
                projectTotalTarget,
                projectOverallAchievement: projectTotalTarget > 0 ? parseFloat((projectTotalActual / projectTotalTarget * 100).toFixed(1)) : 0
            });
        }

        // Grand totals
        const grandTotalActual = reports.reduce((sum, p) => sum + p.projectTotalActual, 0);
        const grandTotalTarget = reports.reduce((sum, p) => sum + p.projectTotalTarget, 0);

        res.json({
            success: true,
            view,
            date: date || null,
            startDate: startDate || null,
            endDate: endDate || null,
            month: month || null,
            year: year || null,
            projects: reports,
            grandTotal: {
                totalActual: grandTotalActual,
                totalTarget: grandTotalTarget,
                overallAchievement: grandTotalTarget > 0 ? parseFloat((grandTotalActual / grandTotalTarget * 100).toFixed(1)) : 0
            }
        });
    } catch (error) {
        console.error('Error generating project report:', error);
        res.status(500).json({ success: false, message: (error && error.message) || 'Server error' });
    }
});

/**
 * GET /api/project-reports/projects
 * Get all projects for filter dropdown
 */
router.get('/projects', verifyToken, isAdmin, async (req, res) => {
    try {
        // Ensure client column exists
        try {
            await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client VARCHAR(255)`);
            await q(`UPDATE projects SET client = customer WHERE client IS NULL AND customer IS NOT NULL`);
        } catch (e) { /* column may already exist */ }

        const result = await q(
            `SELECT id, name, COALESCE(client, customer) as client, status FROM projects WHERE status = 'active' ORDER BY name`
        );
        res.json({ success: true, projects: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/project-reports/sets/:projectId
 * Get sets for a specific project
 */
router.get('/sets/:projectId', verifyToken, isAdmin, async (req, res) => {
    try {
        const hasDeletedAt = await hasColumn('project_sets', 'deleted_at');
        const result = await q(
            `SELECT id, name, total_target, working_days, start_date, end_date, status
             FROM project_sets
             WHERE project_id = $1 AND status = 'active' ${hasDeletedAt ? 'AND deleted_at IS NULL' : ''}
             ORDER BY name`,
            [req.params.projectId]
        );
        res.json({ success: true, sets: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/project-reports/employees/:projectId
 * Get employees assigned to a project
 */
router.get('/employees/:projectId', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await q(
            `SELECT e.id, e.employee_id, e.first_name, e.last_name
             FROM project_employees pe
             JOIN employees e ON pe.employee_id = e.id
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
 * GET /api/project-reports/export
 * Export project report as Excel
 */
router.get('/export', verifyToken, isAdmin, async (req, res) => {
    try {
        const { view, date, startDate, endDate, month, year, projectId, setId, employeeId } = req.query;

        if (!view || !['daily', 'weekly', 'monthly'].includes(view)) {
            return res.status(400).json({ success: false, message: 'View must be daily, weekly, or monthly' });
        }

        // Build the report data by calling the main report logic
        // Reuse the same query logic
        let dateFilter = '';
        let dateParams = [];
        let paramOffset = 0;

        if (view === 'daily') {
            if (!date) return res.status(400).json({ success: false, message: 'Date is required' });
            dateFilter = `AND dwc.work_date = $${++paramOffset}`;
            dateParams.push(date);
        } else if (view === 'weekly') {
            if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'startDate and endDate required' });
            dateFilter = `AND dwc.work_date >= $${++paramOffset} AND dwc.work_date <= $${++paramOffset}`;
            dateParams.push(startDate, endDate);
        } else if (view === 'monthly') {
            if (!month || !year) return res.status(400).json({ success: false, message: 'month and year required' });
            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            dateFilter = `AND dwc.work_date >= $${++paramOffset} AND dwc.work_date <= $${++paramOffset}`;
            dateParams.push(monthStart, monthEnd);
        }

        let projectFilter = '';
        if (projectId && projectId !== 'all') {
            projectFilter = `AND pe.project_id = $${++paramOffset}`;
            dateParams.push(projectId);
        }

        let setFilter = '';
        if (setId && setId !== 'all') {
            setFilter = `AND ps.id = $${++paramOffset}`;
            dateParams.push(setId);
        }

        let employeeFilter = '';
        if (employeeId && employeeId !== 'all') {
            employeeFilter = `AND pe.employee_id = $${++paramOffset}`;
            dateParams.push(employeeId);
        }

        // Get projects
        const hasDeletedAt = await hasColumn('project_sets', 'deleted_at');

        // Ensure client column exists
        try {
            await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS client VARCHAR(255)`);
            await q(`UPDATE projects SET client = customer WHERE client IS NULL AND customer IS NOT NULL`);
        } catch (e) { /* column may already exist */ }

        const projectsQuery = `
            SELECT DISTINCT p.id, p.name, COALESCE(p.client, p.customer) as client
            FROM projects p
            JOIN project_employees pe ON p.id = pe.project_id
            JOIN project_sets ps ON ps.project_id = p.id AND ps.status = 'active' ${hasDeletedAt ? 'AND ps.deleted_at IS NULL' : ''}
            WHERE p.status = 'active' ${projectFilter}
            ORDER BY p.name
        `;
        const projectsResult = await q(projectsQuery, dateParams);

        // Build Excel data
        const columns = [];
        const rows = [];

        if (view === 'daily') {
            columns.push(
                { header: 'PROJECT', key: 'project', width: 20 },
                { header: 'SET', key: 'set', width: 15 },
                { header: 'EMPLOYEE', key: 'employee', width: 20 },
                { header: 'TARGET', key: 'target', width: 10, type: 'number', total: true },
                { header: 'DAILY TARGET', key: 'dailyTarget', width: 12, type: 'number' },
                { header: `${date} ACTUAL`, key: 'actual', width: 12, type: 'number', total: true },
                { header: 'ACHIEVEMENT %', key: 'achievement', width: 14, type: 'percent' },
                { header: 'STATUS', key: 'status', width: 12, type: 'status' }
            );
        } else if (view === 'weekly') {
            columns.push(
                { header: 'PROJECT', key: 'project', width: 20 },
                { header: 'SET', key: 'set', width: 15 },
                { header: 'EMPLOYEE', key: 'employee', width: 20 },
                { header: 'TARGET', key: 'target', width: 10, type: 'number', total: true },
                { header: 'DAILY TARGET', key: 'dailyTarget', width: 12, type: 'number' }
            );

            // Add day columns
            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                    const dayName = dayNames[d.getDay()];
                    const dateStr = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const key = `day_${d.toISOString().split('T')[0]}`;
                    columns.push({ header: `${dayName} ${dateStr}`, key, width: 10, type: 'number', total: true });
                }
            }

            columns.push(
                { header: 'TOTAL ACTUAL', key: 'totalActual', width: 12, type: 'number', total: true },
                { header: 'ACHIEVEMENT %', key: 'achievement', width: 14, type: 'percent' },
                { header: 'STATUS', key: 'status', width: 12, type: 'status' }
            );
        } else if (view === 'monthly') {
            columns.push(
                { header: 'PROJECT', key: 'project', width: 20 },
                { header: 'SET', key: 'set', width: 15 },
                { header: 'EMPLOYEE', key: 'employee', width: 20 },
                { header: 'TARGET', key: 'target', width: 10, type: 'number', total: true },
                { header: 'DAILY TARGET', key: 'dailyTarget', width: 12, type: 'number' }
            );

            // Add day columns for the month
            if (month && year) {
                const lastDay = new Date(year, month, 0).getDate();
                for (let d = 1; d <= lastDay; d++) {
                    const dateObj = new Date(year, month - 1, d);
                    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                    const dayName = dayNames[dateObj.getDay()];
                    const dateStr = `${String(d).padStart(2, '0')}`;
                    const key = `day_${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    columns.push({ header: `${dateStr} ${dayName}`, key, width: 8, type: 'number', total: true });
                }
            }

            columns.push(
                { header: 'TOTAL ACTUAL', key: 'totalActual', width: 12, type: 'number', total: true },
                { header: 'ACHIEVEMENT %', key: 'achievement', width: 14, type: 'percent' },
                { header: 'STATUS', key: 'status', width: 12, type: 'status' }
            );
        }

        // Build rows
        for (const project of projectsResult.rows) {
            const setsQuery = `
                SELECT ps.id, ps.name, ps.total_target, ps.working_days
                FROM project_sets ps
                WHERE ps.project_id = $1 AND ps.status = 'active' ${hasDeletedAt ? 'AND ps.deleted_at IS NULL' : ''}
                ORDER BY ps.name
            `;
            const setsResult = await q(setsQuery, [project.id]);

            for (const set of setsResult.rows) {
                const empQuery = `
                    SELECT e.id, e.first_name, e.last_name, e.employee_id as emp_id
                    FROM project_employees pe
                    JOIN employees e ON pe.employee_id = e.id
                    WHERE pe.project_id = $1 AND e.role != 'admin'
                    ORDER BY e.first_name, e.last_name
                `;
                const empResult = await q(empQuery, [project.id]);
                const empCount = empResult.rows.length || 1;
                const workingDays = set.working_days || 1;
                const targetPerEmployee = Math.ceil(set.total_target / empCount);
                const dailyTarget = Math.ceil(set.total_target / empCount / workingDays);

                for (const emp of empResult.rows) {
                    const row = {
                        project: project.name,
                        set: set.name,
                        employee: `${emp.first_name} ${emp.last_name || ''}`,
                        target: targetPerEmployee,
                        dailyTarget: dailyTarget
                    };

                    let totalActual = 0;

                    if (view === 'daily') {
                        const countQuery = `SELECT COALESCE(SUM(dwc.daily_count), 0) as count FROM daily_work_counts dwc WHERE dwc.set_id = $1 AND dwc.employee_id = $2 ${dateFilter}`;
                        const countResult = await q(countQuery, [set.id, emp.id, ...dateParams]);
                        const actual = parseInt(countResult.rows[0].count) || 0;
                        row.actual = actual;
                        totalActual = actual;
                    } else if (view === 'weekly' || view === 'monthly') {
                        const countQuery = `SELECT dwc.work_date, dwc.daily_count FROM daily_work_counts dwc WHERE dwc.set_id = $1 AND dwc.employee_id = $2 ${dateFilter} ORDER BY dwc.work_date`;
                        const countResult = await q(countQuery, [set.id, emp.id, ...dateParams]);
                        countResult.rows.forEach(r => {
                            const dayKey = `day_${new Date(r.work_date).toISOString().split('T')[0]}`;
                            row[dayKey] = parseInt(r.daily_count) || 0;
                            totalActual += row[dayKey];
                        });
                        row.totalActual = totalActual;
                    }

                    row.achievement = targetPerEmployee > 0 ? totalActual / targetPerEmployee * 100 : 0;
                    row.status = row.achievement >= 100 ? 'ACHIEVED' : 'BELOW';

                    rows.push(row);
                }
            }
        }

        const reportName = `${view.charAt(0).toUpperCase() + view.slice(1)} Project Report`;
        let subtitle = '';
        if (view === 'daily' && date) subtitle = `Date: ${date}`;
        else if (view === 'weekly' && startDate && endDate) subtitle = `${startDate} to ${endDate}`;
        else if (view === 'monthly' && month && year) subtitle = `${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][parseInt(month)]} ${year}`;

        const workbook = await buildReportWorkbook({
            reportName,
            subtitleExtra: subtitle,
            columns,
            rows,
            footerNote: `View: ${view}`
        });

        const filename = `project-report-${view}-${Date.now()}.xlsx`;
        await sendWorkbook(res, workbook, filename);
    } catch (error) {
        console.error('Error exporting project report:', error);
        res.status(500).json({ success: false, message: (error && error.message) || 'Server error' });
    }
});

module.exports = router;
