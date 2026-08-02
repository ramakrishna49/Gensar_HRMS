const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatINR(amount) {
    const n = Number(amount || 0);
    return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().split('T')[0];
    return String(value).substring(0, 10);
}

router.get('/my', verifyToken, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sqlQuery = `
            SELECT p.*, e.first_name, e.last_name, e.employee_id as emp_id
            FROM payroll p
            JOIN employees e ON p.employee_id = e.id
            WHERE p.employee_id = $1
        `;
        const params = [req.user.id];
        let paramIndex = 2;
        
        if (month) { sqlQuery += ` AND p.month = $${paramIndex}`; params.push(month); paramIndex++; }
        if (year) { sqlQuery += ` AND p.year = $${paramIndex}`; params.push(year); paramIndex++; }
        
        sqlQuery += ' ORDER BY p.year DESC, p.month DESC';
        const result = await query(sqlQuery, params);
        res.json({ success: true, payslips: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { month, year } = req.query;
        let sqlQuery = `
            SELECT p.*, e.first_name, e.last_name, e.employee_id as emp_id
            FROM payroll p
            JOIN employees e ON p.employee_id = e.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (month) { sqlQuery += ` AND p.month = $${paramIndex}`; params.push(month); paramIndex++; }
        if (year) { sqlQuery += ` AND p.year = $${paramIndex}`; params.push(year); paramIndex++; }
        
        sqlQuery += ' ORDER BY p.year DESC, p.month DESC, e.first_name';
        const result = await query(sqlQuery, params);
        res.json({ success: true, payroll: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

router.get('/:id', verifyToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT p.*, e.first_name, e.last_name, e.employee_id as emp_id
            FROM payroll p
            JOIN employees e ON p.employee_id = e.id
            WHERE p.id = $1 AND p.employee_id = $2`,
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
        const company = await query(`SELECT setting_value FROM company_settings WHERE setting_key = 'company_name'`);
        const companyName = company.rows.length > 0 ? company.rows[0].setting_value : 'Gensar IT Solutions';
        res.json({ success: true, payslip: { ...result.rows[0], company_name: companyName } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/payroll/:id/pdf
// @desc    Generate a downloadable PDF payslip (employee or admin)
// @access  Private (employee owns the payslip or admin/hr)
router.get('/:id/pdf', verifyToken, async (req, res) => {
    try {
        const isPrivileged = req.user.role === 'admin' || req.user.role === 'hr';
        const result = await query(
            `SELECT p.*, e.first_name, e.last_name, e.employee_id as emp_id,
                e.department_id, d.name as department_name,
                des.name as designation_name
            FROM payroll p
            JOIN employees e ON p.employee_id = e.id
            LEFT JOIN departments d ON e.department_id = d.id
            LEFT JOIN designations des ON e.designation_id = des.id
            WHERE p.id = $1${isPrivileged ? '' : ' AND p.employee_id = $2'}`,
            isPrivileged ? [req.params.id] : [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
        const p = result.rows[0];

        const company = await query(`SELECT setting_key, setting_value FROM company_settings WHERE setting_key IN ('company_name', 'currency')`);
        const settings = {};
        company.rows.forEach(r => settings[r.setting_key] = r.setting_value);
        const companyName = settings.company_name || 'Gensar IT Solutions';
        const currency = settings.currency || 'INR';

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=payslip_${p.emp_id}_${p.month}_${p.year}.pdf`);
        doc.pipe(res);

        // Header band
        doc.rect(0, 0, doc.page.width, 90).fill('#2563EB');
        doc.fill('#FFFFFF').fontSize(20).font('Helvetica-Bold').text(companyName, 50, 25);
        doc.fontSize(10).font('Helvetica').text('Salary Statement', 50, 55);
        doc.fontSize(10).text(`${MONTHS[p.month] || ''} ${p.year}`, { align: 'right' });
        doc.fill('#000000');

        // Employee info
        doc.y = 120;
        doc.font('Helvetica-Bold').fontSize(12).text('Employee Details');
        doc.moveDown(0.4);
        const infoRows = [
            ['Employee ID', p.emp_id || '-'],
            ['Employee Name', `${p.first_name || ''} ${p.last_name || ''}`.trim() || '-'],
            ['Department', p.department_name || '-'],
            ['Designation', p.designation_name || '-'],
            ['Status', p.status || 'processed']
        ];
        doc.font('Helvetica').fontSize(10);
        infoRows.forEach(([label, value], i) => {
            const x = i % 2 === 0 ? 50 : 300;
            const y = doc.y;
            doc.fill('#6B7280').text(label, x, y);
            doc.fill('#111827').text(String(value), x + 85, y);
            if (i % 2 === 1) doc.moveDown(0.5);
        });
        doc.moveDown(0.5);

        // Earnings / deductions table
        doc.font('Helvetica-Bold').fontSize(12).text('Salary Breakdown');
        doc.moveDown(0.4);
        const tableTop = doc.y;
        const colLabelX = 50, colValueX = 420;

        doc.font('Helvetica-Bold').fontSize(10).fill('#374151');
        doc.text('Description', colLabelX, tableTop);
        doc.text('Amount', colValueX, tableTop, { align: 'right' });
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#E5E7EB');

        const rows = [
            ['Basic Salary', formatINR(p.basic_salary)],
            ['Allowances', '+ ' + formatINR(p.allowances || 0)],
            ['Deductions', '- ' + formatINR(p.deductions || 0)]
        ];
        doc.font('Helvetica').fontSize(10).fill('#111827');
        rows.forEach(([label, value]) => {
            doc.moveDown(0.55);
            doc.text(label, colLabelX, doc.y);
            doc.text(value, colValueX, doc.y, { align: 'right' });
        });
        doc.moveDown(0.4);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#E5E7EB');
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(12).fill('#111827');
        doc.text('Net Salary', colLabelX, doc.y);
        doc.font('Helvetica-Bold').fontSize(13).fill('#16A34A');
        doc.text(formatINR(p.net_salary), colValueX, doc.y, { align: 'right' });

        if (p.payment_date) {
            doc.fill('#111827').font('Helvetica').fontSize(9).moveDown(1);
            doc.text(`Payment Date: ${formatDateOnly(p.payment_date)}`, colLabelX, doc.y);
        }

        doc.fill('#6B7280').fontSize(8).moveDown(3);
        doc.text('This is a computer generated salary statement. For any queries, please contact HR.', { align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Generate payslip PDF error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Server error' });
        } else {
            res.end();
        }
    }
});

router.post('/generate', verifyToken, isAdmin, async (req, res) => {
    try {
        const { employee_id, month, year, basic_salary, allowances, deductions } = req.body;
        const b = Number(basic_salary) || 0;
        const a = Number(allowances) || 0;
        const d = Number(deductions) || 0;
        const net_salary = b + a - d;
        
        const result = await query(
            `INSERT INTO payroll (employee_id, month, year, basic_salary, allowances, deductions, net_salary, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'processed')
            ON CONFLICT (employee_id, month, year) 
            DO UPDATE SET basic_salary = $4, allowances = $5, deductions = $6, net_salary = $7, status = 'processed'
            RETURNING *`,
            [employee_id, month, year, b, a, d, net_salary]
        );
        
        res.json({ success: true, payslip: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/payroll/:id
// @desc    Delete a payslip (removes it for both admin and employee views)
// @access  Admin/HR only
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query(
            `DELETE FROM payroll WHERE id = $1 RETURNING id`,
            [req.params.id]
        );
        if (!result.changes || result.changes === 0) {
            return res.status(404).json({ success: false, message: 'Payslip not found' });
        }
        res.json({ success: true, message: 'Payslip deleted successfully' });
    } catch (error) {
        console.error('Delete payslip error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
