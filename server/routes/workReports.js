const express = require('express');
const router = express.Router();
const path = require('path');
const PDFDocument = require('pdfkit');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { runWithSchemaRepair } = require('../utils/schemaRepair');
const { logAudit } = require('../utils/audit');
const { istDateString } = require('../utils/date');
const { buildReportWorkbook, sendWorkbook } = require('../utils/excel');

const q = (sql, params) => runWithSchemaRepair(() => query(sql, params));

const MONTH_SHORT = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDateLabel(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return `${MONTH_SHORT[dt.getMonth() + 1]}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getWeekDates(startStr) {
    const dates = [];
    const start = new Date(startStr + 'T00:00:00');
    for (let i = 0; i < 8; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        dates.push({
            date: dateKey(d),
            label: formatDateLabel(d),
            dayName: DAY_NAMES[d.getDay()],
            isSunday: d.getDay() === 0
        });
    }
    return dates;
}

// @route   GET /api/work-reports/summary
// @desc    Dashboard cards: total projects, total employees, today count, weekly count
// @access  Admin
router.get('/summary', verifyToken, isAdmin, async (req, res) => {
    try {
        const today = istDateString();
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        const weekStart = dateKey(monday);
        const weekEnd = dateKey(sunday);

        const [projRes, empRes, todayRes, weekRes] = await Promise.all([
            q(`SELECT COUNT(*)::int AS count FROM work_projects WHERE status = 'active'`),
            q(`SELECT COUNT(DISTINCT pe.employee_id)::int AS count FROM project_employees pe JOIN work_projects p ON p.id = pe.project_id WHERE pe.status = 'active' AND p.status = 'active'`),
            q(`SELECT COALESCE(SUM(daily_count), 0)::numeric AS total FROM daily_work_counts WHERE work_date = $1`, [today]),
            q(`SELECT COALESCE(SUM(daily_count), 0)::numeric AS total FROM daily_work_counts WHERE work_date >= $1 AND work_date <= $2`, [weekStart, weekEnd])
        ]);

        res.json({
            success: true,
            summary: {
                total_projects: projRes.rows[0].count,
                total_employees: empRes.rows[0].count,
                today_count: Number(todayRes.rows[0].total),
                weekly_count: Number(weekRes.rows[0].total)
            }
        });
    } catch (error) {
        console.error('Work report summary error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-reports/weekly
// @desc    Full weekly report data: projects, employees, counts per date
// @access  Admin
router.get('/weekly', verifyToken, isAdmin, async (req, res) => {
    try {
        let { start, end, project_id } = req.query;

        if (!start) {
            const now = new Date();
            const monday = new Date(now);
            monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
            start = dateKey(monday);
        }
        if (!end) {
            const s = new Date(start + 'T00:00:00');
            s.setDate(s.getDate() + 6);
            end = dateKey(s);
        }

        const dates = getWeekDates(start);
        const dateFrom = dates[0].date;
        const dateTo = dates[dates.length - 1].date;

        // Fetch holidays
        const holRes = await q(
            'SELECT to_char(holiday_date, \'YYYY-MM-DD\') AS d, holiday_name FROM work_holidays WHERE holiday_date >= $1 AND holiday_date <= $2',
            [dateFrom, dateTo]
        );
        const holidayMap = {};
        holRes.rows.forEach(h => { holidayMap[h.d] = h.holiday_name; });

        // Fetch active projects
        let projSql = `SELECT * FROM work_projects WHERE status = 'active'`;
        const projParams = [];
        let pIdx = 1;
        if (project_id) {
            projSql += ` AND id = $${pIdx}`;
            projParams.push(project_id);
            pIdx++;
        }
        projSql += ' ORDER BY name ASC';
        const projRes = await q(projSql, projParams);

        const projects = [];
        const grandTotal = {};
        dates.forEach(d => { grandTotal[d.date] = 0; });

        for (const proj of projRes.rows) {
            // Fetch assigned employees
            const empRes = await q(
                `SELECT e.id, e.first_name, e.last_name, e.employee_id AS emp_code
                FROM project_employees pe
                JOIN employees e ON e.id = pe.employee_id
                WHERE pe.project_id = $1 AND pe.status = 'active'
                ORDER BY e.first_name`,
                [proj.id]
            );

            // Fetch all counts for this project in the date range
            const countRes = await q(
                `SELECT employee_id, to_char(work_date, \'YYYY-MM-DD\') AS d, daily_count
                FROM daily_work_counts
                WHERE project_id = $1 AND work_date >= $2 AND work_date <= $3`,
                [proj.id, dateFrom, dateTo]
            );

            // Build count map: { employeeId: { date: count } }
            const countMap = {};
            countRes.rows.forEach(c => {
                if (!countMap[c.employee_id]) countMap[c.employee_id] = {};
                countMap[c.employee_id][c.d] = Number(c.daily_count);
            });

            const dailyTarget = proj.working_days > 0
                ? Math.round((Number(proj.weekly_target_per_employee) / proj.working_days) * 100) / 100
                : 0;

            const employees = empRes.rows.map(emp => {
                const counts = {};
                dates.forEach(d => {
                    counts[d.date] = (countMap[emp.id] && countMap[emp.id][d.date]) || 0;
                });
                return {
                    id: emp.id,
                    name: emp.first_name + ' ' + emp.last_name,
                    emp_code: emp.emp_code,
                    weekly_target: Number(proj.weekly_target_per_employee),
                    daily_target: dailyTarget,
                    counts
                };
            });

            // Project totals per date
            const projectTotal = {};
            dates.forEach(d => { projectTotal[d.date] = 0; });
            employees.forEach(emp => {
                dates.forEach(d => {
                    projectTotal[d.date] += emp.counts[d.date];
                    grandTotal[d.date] += emp.counts[d.date];
                });
            });

            // Round totals
            dates.forEach(d => {
                projectTotal[d.date] = Math.round(projectTotal[d.date] * 100) / 100;
                grandTotal[d.date] = Math.round(grandTotal[d.date] * 100) / 100;
            });

            projects.push({
                id: proj.id,
                name: proj.name,
                customer_name: proj.customer_name,
                weekly_target_per_employee: Number(proj.weekly_target_per_employee),
                daily_target: dailyTarget,
                working_days: proj.working_days,
                assigned_count: employees.length,
                weekly_target_total: Math.round(Number(proj.weekly_target_per_employee) * employees.length * 100) / 100,
                daily_target_total: Math.round(dailyTarget * employees.length * 100) / 100,
                employees,
                project_total: projectTotal
            });
        }

        res.json({
            success: true,
            dateRange: { start: dates[0].date, end: dates[dates.length - 1].date, dates },
            holidays: holidayMap,
            projects,
            grand_total: grandTotal
        });
    } catch (error) {
        console.error('Weekly report error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-reports/excel
// @desc    Export weekly report as branded Excel
// @access  Admin
router.get('/excel', verifyToken, isAdmin, async (req, res) => {
    try {
        let { start, end } = req.query;
        if (!start) {
            const now = new Date();
            const monday = new Date(now);
            monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
            start = dateKey(monday);
        }
        if (!end) {
            const s = new Date(start + 'T00:00:00');
            s.setDate(s.getDate() + 6);
            end = dateKey(s);
        }

        const dates = getWeekDates(start);

        // Build columns
        const columns = [
            { header: 'Project', key: 'project', width: 22 },
            { header: 'Employee Name', key: 'name', width: 28 },
            { header: 'Emp ID', key: 'emp_code', width: 12 },
            { header: 'Weekly Target', key: 'weekly_target', type: 'number', width: 14 },
            { header: 'Daily Target', key: 'daily_target', type: 'number', width: 12 }
        ];
        dates.forEach(d => {
            columns.push({ header: d.label + '\n' + d.dayName, key: 'd_' + d.date, type: 'number', width: 11 });
        });
        columns.push({ header: 'Total', key: 'total', type: 'number', width: 11 });

        // Fetch report data (reuse weekly logic inline)
        const dateFrom = dates[0].date;
        const dateTo = dates[dates.length - 1].date;
        const projRes = await q(`SELECT * FROM work_projects WHERE status = 'active' ORDER BY name`);

        const rows = [];
        const grandTotalRow = { project: '', name: 'GRAND TOTAL', emp_code: '', weekly_target: '', daily_target: '' };
        dates.forEach(d => { grandTotalRow['d_' + d.date] = 0; grandTotalRow.total = 0; });

        for (const proj of projRes.rows) {
            const empRes = await q(
                `SELECT e.id, e.first_name, e.last_name, e.employee_id AS emp_code
                FROM project_employees pe JOIN employees e ON e.id = pe.employee_id
                WHERE pe.project_id = $1 AND pe.status = 'active' ORDER BY e.first_name`,
                [proj.id]
            );

            const countRes = await q(
                `SELECT employee_id, to_char(work_date, 'YYYY-MM-DD') AS d, daily_count
                FROM daily_work_counts WHERE project_id = $1 AND work_date >= $2 AND work_date <= $3`,
                [proj.id, dateFrom, dateTo]
            );
            const countMap = {};
            countRes.rows.forEach(c => {
                if (!countMap[c.employee_id]) countMap[c.employee_id] = {};
                countMap[c.employee_id][c.d] = Number(c.daily_count);
            });

            const dailyTarget = proj.working_days > 0
                ? Math.round((Number(proj.weekly_target_per_employee) / proj.working_days) * 100) / 100
                : 0;

            const projTotalRow = { project: proj.name + ' TOTAL', name: '', emp_code: '', weekly_target: '', daily_target: '' };
            dates.forEach(d => { projTotalRow['d_' + d.date] = 0; projTotalRow.total = 0; });

            empRes.rows.forEach((emp, idx) => {
                const row = {
                    project: idx === 0 ? proj.name : '',
                    name: emp.first_name + ' ' + emp.last_name,
                    emp_code: emp.emp_code,
                    weekly_target: Number(proj.weekly_target_per_employee),
                    daily_target: dailyTarget,
                    total: 0
                };
                dates.forEach(d => {
                    const count = (countMap[emp.id] && countMap[emp.id][d.date]) || 0;
                    row['d_' + d.date] = count;
                    row.total += count;
                    projTotalRow['d_' + d.date] += count;
                    grandTotalRow['d_' + d.date] += count;
                });
                row.total = Math.round(row.total * 100) / 100;
                rows.push(row);
            });

            // Project total row
            dates.forEach(d => {
                projTotalRow['d_' + d.date] = Math.round(projTotalRow['d_' + d.date] * 100) / 100;
                projTotalRow.total += projTotalRow['d_' + d.date];
            });
            projTotalRow.total = Math.round(projTotalRow.total * 100) / 100;
            rows.push(projTotalRow);
        }

        // Grand total
        dates.forEach(d => {
            grandTotalRow['d_' + d.date] = Math.round(grandTotalRow['d_' + d.date] * 100) / 100;
        });
        grandTotalRow.total = dates.reduce((sum, d) => sum + grandTotalRow['d_' + d.date], 0);
        grandTotalRow.total = Math.round(grandTotalRow.total * 100) / 100;
        rows.push(grandTotalRow);

        const wb = await buildReportWorkbook({
            reportName: 'Daily & Weekly Work Count',
            subtitleExtra: `${formatDateLabel(new Date(start + 'T00:00:00'))} to ${formatDateLabel(new Date(end + 'T00:00:00'))}`,
            columns,
            rows,
            footerNote: req.user.name || 'Admin'
        });

        logAudit({
            actorId: req.user.id,
            action: 'data.export',
            entityType: 'report',
            entityId: null,
            details: { report: 'work_count_weekly', start, end, records: rows.length },
            ip: req.ip
        });

        await sendWorkbook(res, wb, `Work_Count_${start}_to_${end}.xlsx`);
    } catch (error) {
        console.error('Work report Excel export error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/work-reports/pdf
// @desc    Export weekly report as landscape PDF
// @access  Admin
router.get('/pdf', verifyToken, isAdmin, async (req, res) => {
    try {
        let { start, end } = req.query;
        if (!start) {
            const now = new Date();
            const monday = new Date(now);
            monday.setDate(monday.getDate() - monday.getDay() + (monday.getDay() === 0 ? -6 : 1));
            start = dateKey(monday);
        }
        if (!end) {
            const s = new Date(start + 'T00:00:00');
            s.setDate(s.getDate() + 6);
            end = dateKey(s);
        }

        const dates = getWeekDates(start);
        const dateFrom = dates[0].date;
        const dateTo = dates[dates.length - 1].date;

        const projRes = await q(`SELECT * FROM work_projects WHERE status = 'active' ORDER BY name`);

        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => {
            const buf = Buffer.concat(chunks);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=Work_Count_${start}_to_${end}.pdf`);
            res.send(buf);
        });

        const W = doc.page.width - 60;
        const H = doc.page.height - 60;
        const PURPLE = '#4F46E5';
        const DARK = '#1F2937';
        const LIGHT = '#F3F4F6';
        const GREEN_BG = '#D1FAE5';
        const YELLOW_BG = '#FEF3C7';

        // Header
        doc.rect(30, 30, W, 36).fill(PURPLE);
        doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(14)
            .text('DAILY & WEEKLY WORK COUNT REPORT', 40, 38, { width: W - 20, lineBreak: false });
        doc.fill('#E0E7FF').font('Helvetica').fontSize(9)
            .text(`${formatDateLabel(new Date(start + 'T00:00:00'))} to ${formatDateLabel(new Date(end + 'T00:00:00'))}  |  Generated: ${new Date().toLocaleString('en-IN')}`, 40, 56, { width: W - 20, lineBreak: false });

        let y = 76;

        // Column widths
        const COL_PROJECT = 80;
        const COL_NAME = 130;
        const COL_EMPID = 55;
        const COL_WTARGET = 60;
        const COL_DTARGET = 55;
        const FIXED_COLS = COL_PROJECT + COL_NAME + COL_EMPID + COL_WTARGET + COL_DTARGET;
        const dateColW = Math.max(40, (W - FIXED_COLS - 45) / dates.length);
        const COL_TOTAL = 45;

        // Table header
        doc.rect(30, y, W, 18).fill(LIGHT);
        let x = 32;
        const drawHeaderText = (text, width) => {
            doc.fill(DARK).font('Helvetica-Bold').fontSize(7).text(text, x + 2, y + 4, { width: width - 4, align: 'center', lineBreak: false });
            x += width;
        };
        drawHeaderText('PROJECT', COL_PROJECT);
        drawHeaderText('EMPLOYEE NAME', COL_NAME);
        drawHeaderText('EMP ID', COL_EMPID);
        drawHeaderText('W.TARGET', COL_WTARGET);
        drawHeaderText('D.TARGET', COL_DTARGET);
        dates.forEach(d => {
            const label = d.label + '\n' + d.dayName;
            doc.fill(d.isSunday ? '#9CA3AF' : DARK).font('Helvetica-Bold').fontSize(6.5)
                .text(d.label, x + 2, y + 2, { width: dateColW - 4, align: 'center', lineBreak: false });
            doc.fill(d.isSunday ? '#9CA3AF' : DARK).font('Helvetica').fontSize(6)
                .text(d.dayName, x + 2, y + 10, { width: dateColW - 4, align: 'center', lineBreak: false });
            x += dateColW;
        });
        drawHeaderText('TOTAL', COL_TOTAL);
        y += 18;

        // Data rows
        const rowH = 13;
        for (const proj of projRes.rows) {
            const empRes = await q(
                `SELECT e.id, e.first_name, e.last_name, e.employee_id AS emp_code
                FROM project_employees pe JOIN employees e ON e.id = pe.employee_id
                WHERE pe.project_id = $1 AND pe.status = 'active' ORDER BY e.first_name`,
                [proj.id]
            );
            const countRes = await q(
                `SELECT employee_id, to_char(work_date, 'YYYY-MM-DD') AS d, daily_count
                FROM daily_work_counts WHERE project_id = $1 AND work_date >= $2 AND work_date <= $3`,
                [proj.id, dateFrom, dateTo]
            );
            const countMap = {};
            countRes.rows.forEach(c => {
                if (!countMap[c.employee_id]) countMap[c.employee_id] = {};
                countMap[c.employee_id][c.d] = Number(c.daily_count);
            });

            const dailyTarget = proj.working_days > 0
                ? Math.round((Number(proj.weekly_target_per_employee) / proj.working_days) * 100) / 100
                : 0;

            const projTotal = {};
            dates.forEach(d => { projTotal[d.date] = 0; });

            empRes.rows.forEach((emp, idx) => {
                if (y + rowH > H + 30) {
                    doc.addPage();
                    y = 30;
                }

                const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
                doc.rect(30, y, W, rowH).fill(bgColor);

                x = 32;
                const drawCell = (text, width, bold, align) => {
                    doc.fill(DARK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
                        .text(String(text), x + 2, y + 3, { width: width - 4, align: align || 'left', lineBreak: false });
                    x += width;
                };

                drawCell(idx === 0 ? proj.name : '', COL_PROJECT, true);
                drawCell(emp.first_name + ' ' + emp.last_name, COL_NAME, false);
                drawCell(emp.emp_code || '', COL_EMPID, false, 'center');
                drawCell(proj.weekly_target_per_employee, COL_WTARGET, false, 'right');
                drawCell(dailyTarget, COL_DTARGET, false, 'right');

                let empTotal = 0;
                dates.forEach(d => {
                    const count = (countMap[emp.id] && countMap[emp.id][d.date]) || 0;
                    empTotal += count;
                    projTotal[d.date] += count;
                    doc.fill(d.isSunday ? '#9CA3AF' : DARK).font('Helvetica').fontSize(7)
                        .text(count > 0 ? String(count) : '-', x + 2, y + 3, { width: dateColW - 4, align: 'right', lineBreak: false });
                    x += dateColW;
                });
                doc.fill(DARK).font('Helvetica-Bold').fontSize(7)
                    .text(String(Math.round(empTotal * 100) / 100), x + 2, y + 3, { width: COL_TOTAL - 4, align: 'right', lineBreak: false });

                y += rowH;
            });

            // Project total row
            if (y + rowH > H + 30) { doc.addPage(); y = 30; }
            doc.rect(30, y, W, rowH).fill(GREEN_BG);
            x = 32;
            doc.fill(DARK).font('Helvetica-Bold').fontSize(7)
                .text(proj.name.toUpperCase() + ' TOTAL', x + 2, y + 3, { width: COL_PROJECT + COL_NAME - 4, lineBreak: false });
            x += COL_PROJECT + COL_NAME + COL_EMPID + COL_WTARGET + COL_DTARGET;

            let projTotalSum = 0;
            dates.forEach(d => {
                const val = Math.round(projTotal[d.date] * 100) / 100;
                projTotalSum += val;
                doc.fill(DARK).font('Helvetica-Bold').fontSize(7)
                    .text(val > 0 ? String(val) : '-', x + 2, y + 3, { width: dateColW - 4, align: 'right', lineBreak: false });
                x += dateColW;
            });
            doc.fill(DARK).font('Helvetica-Bold').fontSize(7)
                .text(String(Math.round(projTotalSum * 100) / 100), x + 2, y + 3, { width: COL_TOTAL - 4, align: 'right', lineBreak: false });
            y += rowH + 4;
        }

        // Grand total row
        if (y + rowH > H + 30) { doc.addPage(); y = 30; }
        doc.rect(30, y, W, rowH).fill(YELLOW_BG);
        x = 32;
        doc.fill(DARK).font('Helvetica-Bold').fontSize(8)
            .text('GRAND TOTAL', x + 2, y + 3, { width: COL_PROJECT + COL_NAME + COL_EMPID + COL_WTARGET + COL_DTARGET - 4, lineBreak: false });
        x += COL_PROJECT + COL_NAME + COL_EMPID + COL_WTARGET + COL_DTARGET;

        // Re-fetch for grand total
        const grandTotal = {};
        dates.forEach(d => { grandTotal[d.date] = 0; });
        for (const proj of projRes.rows) {
            const countRes = await q(
                `SELECT to_char(work_date, 'YYYY-MM-DD') AS d, SUM(daily_count) AS total
                FROM daily_work_counts WHERE project_id = $1 AND work_date >= $2 AND work_date <= $3
                GROUP BY work_date`,
                [proj.id, dateFrom, dateTo]
            );
            countRes.rows.forEach(c => {
                grandTotal[c.d] = (grandTotal[c.d] || 0) + Number(c.total);
            });
        }

        let grandSum = 0;
        dates.forEach(d => {
            const val = Math.round((grandTotal[d.date] || 0) * 100) / 100;
            grandSum += val;
            doc.fill(DARK).font('Helvetica-Bold').fontSize(8)
                .text(val > 0 ? String(val) : '-', x + 2, y + 3, { width: dateColW - 4, align: 'right', lineBreak: false });
            x += dateColW;
        });
        doc.fill(DARK).font('Helvetica-Bold').fontSize(8)
            .text(String(Math.round(grandSum * 100) / 100), x + 2, y + 3, { width: COL_TOTAL - 4, align: 'right', lineBreak: false });

        // Footer
        y += rowH + 12;
        doc.fill('#9CA3AF').font('Helvetica').fontSize(7)
            .text(`Generated by ${req.user.name || 'Admin'} • Gensar HRMS`, 30, Math.max(y, H - 10), { width: W, align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Work report PDF export error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
