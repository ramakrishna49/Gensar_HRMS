const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { sendPayslipEmail } = require('../services/email');

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Roboto ships with the Indian Rupee glyph (₹). pdfkit's built-in Helvetica
// cannot render it, so we embed Roboto and only fall back when the font files
// are missing. Uses ₹ on screen and in emails (client html2pdf renders it too).
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
let fontsReady = false;
try {
    fs.accessSync(path.join(FONT_DIR, 'Roboto-Regular.ttf'));
    fs.accessSync(path.join(FONT_DIR, 'Roboto-Bold.ttf'));
    fontsReady = true;
} catch (e) {
    fontsReady = false;
}

const FONT_REG = fontsReady ? 'Roboto' : 'Helvetica';
const FONT_BOLD = fontsReady ? 'Roboto-Bold' : 'Helvetica-Bold';

function formatINR(amount) {
    const n = Number(amount || 0);
    return (fontsReady ? '₹' : 'Rs. ') + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateOnly(value) {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString().split('T')[0];
    return String(value).substring(0, 10);
}

function num(value) {
    return Number(value) || 0;
}

// Indian numbering: Rupees .. Lakh .. Thousand .. Hundred .. Paise Only
function amountToWords(amount) {
    const value = Math.round(Number(amount || 0) * 100) / 100;
    const paise = Math.round((value - Math.floor(value)) * 100);
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigits(n) {
        if (n < 20) return ones[n];
        return (tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''));
    }

    function threeDigits(n) {
        const h = Math.floor(n / 100);
        const rest = n % 100;
        let str = '';
        if (h) str += ones[h] + ' Hundred' + (rest ? ' ' : '');
        if (rest) str += twoDigits(rest);
        return str.trim();
    }

    let rupees = Math.floor(value);
    let words = '';

    if (rupees === 0) {
        words = 'Zero';
    } else {
        const crore = Math.floor(rupees / 10000000);
        rupees %= 10000000;
        const lakh = Math.floor(rupees / 100000);
        rupees %= 100000;
        const thousand = Math.floor(rupees / 1000);
        rupees %= 1000;
        const hundred = Math.floor(rupees / 100);
        const rest = rupees % 100;

        if (crore) words += threeDigits(crore) + ' Crore ';
        if (lakh) words += twoDigits(lakh) + ' Lakh ';
        if (thousand) words += twoDigits(thousand) + ' Thousand ';
        if (hundred) words += ones[hundred] + ' Hundred ';
        if (rest) words += twoDigits(rest);
    }

    words = words.trim().replace(/\s+/g, ' ');
    let result = 'Rupees ' + words;
    if (paise > 0) {
        result += ' and ' + twoDigits(paise) + ' Paise';
    }
    result += ' Only';
    return result;
}

// Compute gross / total deductions / net / employer total.
function computeTotals(v) {
    const gross = num(v.basic_salary) + num(v.hra) + num(v.conveyance) + num(v.medical)
        + num(v.special_allowance) + num(v.bonus) + num(v.incentive) + num(v.other_allowance);
    const totalDeductions = num(v.pf) + num(v.esi) + num(v.professional_tax) + num(v.income_tax)
        + num(v.loan_deduction) + num(v.advance_salary) + num(v.other_deduction);
    const net = gross - totalDeductions;
    const employerTotal = num(v.employer_pf) + num(v.employer_esi) + num(v.employer_contribution);
    return { gross, totalDeductions, net, employerTotal };
}

// Company branding + contact block used on the payslip.
async function getCompanyData() {
    const comp = await query('SELECT * FROM companies LIMIT 1');
    const settings = await query('SELECT setting_key, setting_value FROM company_settings');
    const map = {};
    settings.rows.forEach(s => { map[s.setting_key] = s.setting_value; });
    const c = comp.rows[0] || {};
    return {
        name: c.name || map.company_name || 'Gensar IT Solutions',
        logo: c.logo || null,
        address: c.address || '',
        phone: c.phone || '',
        email: c.email || map.hr_email || '',
        website: c.website || ''
    };
}

// Full auto-fetch payload: payroll row + employee profile + company details.
async function fetchPayslipWithProfile(id, userId, isPrivileged) {
    const result = await query(
        `SELECT p.*, e.first_name, e.last_name, e.employee_id as emp_id,
            e.personal_email as employee_email, e.joining_date, e.profile_photo,
            e.pan_number, e.uan_number, e.pf_number, e.esi_number,
            e.bank_name, e.bank_account, e.bank_ifsc,
            d.name as department_name, des.name as designation_name
        FROM payroll p
        JOIN employees e ON p.employee_id = e.id
        LEFT JOIN departments d ON e.department_id = d.id
        LEFT JOIN designations des ON e.designation_id = des.id
        WHERE p.id = $1${isPrivileged ? '' : ' AND p.employee_id = $2'}`,
        isPrivileged ? [id] : [id, userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    const company = await getCompanyData();
    return { ...row, company };
}

// Server-side A4 payslip render (used for email fallback + legacy /:id/pdf download).
async function renderPayslipPdf(p, company) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 0 });
            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const PW = doc.page.width;
            const ml = 50;
            const mr = PW - 50;

            if (fontsReady) {
                doc.registerFont('Roboto', path.join(FONT_DIR, 'Roboto-Regular.ttf'));
                doc.registerFont('Roboto-Bold', path.join(FONT_DIR, 'Roboto-Bold.ttf'));
            }

            // Header band
            doc.rect(0, 0, PW, 118).fill('#4F46E5');
            doc.rect(0, 112, PW, 6).fill('#818CF8');
            doc.fill('#FFFFFF').font(FONT_BOLD).fontSize(20).text(p.company_name || company.name, ml, 24);
            doc.font(FONT_REG).fontSize(9);
            let hy = 48;
            const hlines = [];
            if (company.address) hlines.push(company.address);
            if (company.phone) hlines.push(`Phone: ${company.phone}`);
            if (company.email) hlines.push(`Email: ${company.email}`);
            if (company.website) hlines.push(`Web: ${company.website}`);
            hlines.forEach(l => { doc.fill('#E0E7FF').text(l, ml, hy); hy += 12; });
            doc.fill('#FFFFFF').font(FONT_BOLD).fontSize(15).text('PAYSLIP', mr, 40, { align: 'right' });
            doc.font(FONT_REG).fontSize(11).text(`${MONTHS[p.month] || ''} ${p.year}`, mr, 62, { align: 'right' });
            doc.fill('#000000');

            let y = 140;

            // Employee details card
            doc.roundedRect(ml, y, PW - 100, 132, 8).fill('#EEF2FF');
            doc.fill('#4F46E5').font(FONT_BOLD).fontSize(11).text('EMPLOYEE DETAILS', ml + 14, y + 12);
            doc.fill('#1F2937').font(FONT_REG).fontSize(9);
            const empLeft = [
                ['Employee ID', p.emp_id || '-'],
                ['Employee Name', `${p.first_name || ''} ${p.last_name || ''}`.trim() || '-'],
                ['Designation', p.designation_name || '-'],
                ['Department', p.department_name || '-'],
                ['Date of Joining', formatDateOnly(p.joining_date)],
                ['PAN Number', p.pan_number || '-']
            ];
            const empRight = [
                ['Pay Period', `${MONTHS[p.month] || ''} ${p.year}`],
                ['Working Days', p.working_days || 0],
                ['Present Days', p.present_days || 0],
                ['Leave Days', p.leave_days || 0],
                ['LOP Days', p.lop_days || 0],
                ['Bank Account', p.bank_account || '-']
            ];
            let ex = ml + 14, ey = y + 30;
            empLeft.forEach(([k, v]) => { doc.fill('#6B7280').text(k, ex, ey); doc.fill('#1F2937').text(String(v), ex + 95, ey); ey += 16; });
            let fx = ml + 14 + (PW - 100) / 2, fy = y + 30;
            empRight.forEach(([k, v]) => { doc.fill('#6B7280').text(k, fx, fy); doc.fill('#1F2937').text(String(v), fx + 95, fy); fy += 16; });
            y += 132 + 18;

            // Earnings / Deductions tables
            const half = (PW - 100) / 2;
            doc.fill('#1F2937').font(FONT_BOLD).fontSize(11).text('EARNINGS', ml, y);
            doc.fill('#1F2937').font(FONT_BOLD).fontSize(11).text('DEDUCTIONS', ml + half + 14, y);
            y += 18;

            const earnings = [
                ['Basic Salary', num(p.basic_salary)],
                ['HRA', num(p.hra)],
                ['Conveyance', num(p.conveyance)],
                ['Medical Allowance', num(p.medical)],
                ['Special Allowance', num(p.special_allowance)],
                ['Bonus', num(p.bonus)],
                ['Incentive', num(p.incentive)],
                ['Other Allowance', num(p.other_allowance)]
            ];
            const deductions = [
                ['Employee PF', num(p.pf)],
                ['Employee ESI', num(p.esi)],
                ['Professional Tax', num(p.professional_tax)],
                ['Income Tax', num(p.income_tax)],
                ['Loan Deduction', num(p.loan_deduction)],
                ['Advance Salary', num(p.advance_salary)],
                ['Other Deduction', num(p.other_deduction)]
            ];

            const drawMoneyTable = (x, rows, total, totalLabel) => {
                let ty = y;
                rows.forEach(([k, v]) => {
                    doc.fill('#6B7280').font(FONT_REG).fontSize(9).text(k, x, ty);
                    doc.fill('#1F2937').text(formatINR(v), x + 120, ty, { align: 'right', width: 90 });
                    ty += 15;
                });
                doc.rect(x - 6, ty, half, 22).fill('#EEF2FF');
                doc.fill('#4F46E5').font(FONT_BOLD).fontSize(9).text(totalLabel, x, ty + 5);
                doc.fill('#4F46E5').text(formatINR(total), x + 120, ty + 5, { align: 'right', width: 90 });
            };

            drawMoneyTable(ml, earnings, num(p.gross_salary), 'Total Earnings');
            drawMoneyTable(ml + half + 14, deductions, num(p.total_deductions), 'Total Deductions');
            y += 8 * 15 + 22 + 22;

            // Summary cards
            const cardW = (PW - 100 - 28) / 3;
            const cards = [
                { label: 'Gross Salary', value: num(p.gross_salary), color: '#4F46E5' },
                { label: 'Total Deductions', value: num(p.total_deductions), color: '#F59E0B' },
                { label: 'Net Salary Payable', value: num(p.net_salary), color: '#10B981' }
            ];
            let cx = ml;
            cards.forEach(card => {
                doc.roundedRect(cx, y, cardW, 58, 8).fill(card.color);
                doc.fill('#FFFFFF').font(FONT_REG).fontSize(8).text(card.label.toUpperCase(), cx + 10, y + 10);
                doc.font(FONT_BOLD).fontSize(13).text(formatINR(card.value), cx + 10, y + 26);
                cx += cardW + 14;
            });
            y += 58 + 18;

            // Net in words
            doc.roundedRect(ml, y, PW - 100, 30, 8).fill('#EEF2FF');
            doc.fill('#4F46E5').font(FONT_BOLD).fontSize(9).text('NET SALARY IN WORDS', ml + 14, y + 4);
            doc.fill('#1F2937').font(FONT_REG).fontSize(9).text(amountToWords(p.net_salary), ml + 14, y + 15);
            y += 30 + 16;

            // Attendance summary + Employer contribution
            doc.fill('#1F2937').font(FONT_BOLD).fontSize(11).text('ATTENDANCE SUMMARY', ml, y);
            doc.fill('#1F2937').font(FONT_BOLD).fontSize(11).text('EMPLOYER CONTRIBUTION', ml + half + 14, y);
            y += 18;
            const attRows = [
                ['Working Days', p.working_days || 0],
                ['Present Days', p.present_days || 0],
                ['Leave Days', p.leave_days || 0],
                ['LOP Days', p.lop_days || 0]
            ];
            const empRows = [
                ['Employer PF', num(p.employer_pf)],
                ['Employer ESI', num(p.employer_esi)],
                ['Employer Contribution', num(p.employer_contribution)]
            ];
            let ay = y;
            attRows.forEach(([k, v]) => { doc.fill('#6B7280').font(FONT_REG).fontSize(9).text(k, ml, ay); doc.fill('#1F2937').text(String(v), ml + 120, ay, { align: 'right', width: 90 }); ay += 15; });
            let by = y;
            empRows.forEach(([k, v]) => { doc.fill('#6B7280').font(FONT_REG).fontSize(9).text(k, ml + half + 14, by); doc.fill('#1F2937').text(formatINR(v), ml + half + 14 + 120, by, { align: 'right', width: 90 }); by += 15; });
            by += 2;
            doc.rect(ml + half + 14 - 6, by, half, 22).fill('#EEF2FF');
            doc.fill('#4F46E5').font(FONT_BOLD).fontSize(9).text('Total', ml + half + 14, by + 5);
            doc.fill('#4F46E5').text(formatINR(num(p.employer_pf) + num(p.employer_esi) + num(p.employer_contribution)), ml + half + 14 + 120, by + 5, { align: 'right', width: 90 });
            y += 4 * 15 + 26;

            // Footer
            if (y < 780) y = 780;
            doc.rect(0, y, PW, 34).fill('#4F46E5');
            doc.fill('#FFFFFF').font(FONT_REG).fontSize(8).text('This is a system generated payslip. No signature required.', PW / 2, y + 12, { align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// Convert an incoming base64 PDF payload into a Buffer (handles data URIs).
function pdfFromBase64(pdfBase64) {
    if (!pdfBase64) return null;
    const cleaned = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
    return Buffer.from(cleaned, 'base64');
}

// @route   GET /api/payroll/my
// @desc    Current employee's payslips
// @access  Private
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
        console.error('Get my payroll error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/payroll/all
// @desc    All payroll records (admin), filterable by month/year/status/search
// @access  Admin
router.get('/all', verifyToken, isAdmin, async (req, res) => {
    try {
        const { month, year, status, search, limit } = req.query;
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
        if (status) { sqlQuery += ` AND p.status = $${paramIndex}`; params.push(status); paramIndex++; }
        if (search) {
            sqlQuery += ` AND (LOWER(e.first_name) LIKE LOWER($${paramIndex}) OR LOWER(e.last_name) LIKE LOWER($${paramIndex}) OR LOWER(e.employee_id) LIKE LOWER($${paramIndex}))`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        sqlQuery += ' ORDER BY p.year DESC, p.month DESC, e.first_name';
        if (limit) {
            sqlQuery += ` LIMIT $${paramIndex}`;
            params.push(parseInt(limit));
        }
        const result = await query(sqlQuery, params);
        res.json({ success: true, payroll: result.rows });
    } catch (error) {
        console.error('Get all payroll error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/payroll/:id
// @desc    Full payslip payload (components + employee profile + company) for preview/PDF/print/email
// @access  Private (owner or admin)
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const isPrivileged = req.user.role === 'admin';
        const row = await fetchPayslipWithProfile(req.params.id, req.user.id, isPrivileged);
        if (!row) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, payslip: row });
    } catch (error) {
        console.error('Get payroll error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   GET /api/payroll/:id/pdf
// @desc    Server-rendered PDF download (fallback / backward compatible)
// @access  Private (owner or admin)
router.get('/:id/pdf', verifyToken, async (req, res) => {
    try {
        const isPrivileged = req.user.role === 'admin';
        const row = await fetchPayslipWithProfile(req.params.id, req.user.id, isPrivileged);
        if (!row) return res.status(404).json({ success: false, message: 'Payslip not found' });
        const buf = await renderPayslipPdf(row, row.company);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=payslip_${row.emp_id}_${row.month}_${row.year}.pdf`);
        res.send(buf);
    } catch (error) {
        console.error('Generate payslip PDF error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/payroll/generate
// @desc    Create/update a payslip (processed) and auto-email the employee with the PDF
// @access  Admin
router.post('/generate', verifyToken, isAdmin, async (req, res) => {
    try {
        const v = req.body;
        const employee_id = v.employee_id;
        const month = parseInt(v.month, 10);
        const year = parseInt(v.year, 10);

        if (!employee_id || !month || !year) {
            return res.status(400).json({ success: false, message: 'Employee, month and year are required' });
        }

        const totals = computeTotals(v);
        const gross = totals.gross;
        const totalDeductions = totals.totalDeductions;
        const net = totals.net;
        // Keep legacy columns in sync for older report code.
        const allowances = gross - num(v.basic_salary);
        const deductions = totalDeductions;

        const result = await query(
            `INSERT INTO payroll (
                employee_id, month, year, working_days, present_days, leave_days, lop_days,
                basic_salary, hra, conveyance, medical, special_allowance, bonus, incentive, other_allowance,
                pf, esi, professional_tax, income_tax, loan_deduction, advance_salary, other_deduction,
                employer_pf, employer_esi, employer_contribution,
                gross_salary, total_deductions, allowances, deductions, net_salary, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22,
                $23, $24, $25,
                $26, $27, $28, $29, $30, 'processed'
            )
            ON CONFLICT (employee_id, month, year) DO UPDATE SET
                working_days = $4, present_days = $5, leave_days = $6, lop_days = $7,
                basic_salary = $8, hra = $9, conveyance = $10, medical = $11, special_allowance = $12,
                bonus = $13, incentive = $14, other_allowance = $15,
                pf = $16, esi = $17, professional_tax = $18, income_tax = $19, loan_deduction = $20,
                advance_salary = $21, other_deduction = $22,
                employer_pf = $23, employer_esi = $24, employer_contribution = $25,
                gross_salary = $26, total_deductions = $27, allowances = $28, deductions = $29,
                net_salary = $30, status = 'processed', updated_at = NOW()
            RETURNING *`,
            [
                employee_id, month, year,
                parseInt(v.working_days) || 0, parseInt(v.present_days) || 0,
                parseInt(v.leave_days) || 0, parseInt(v.lop_days) || 0,
                num(v.basic_salary), num(v.hra), num(v.conveyance), num(v.medical),
                num(v.special_allowance), num(v.bonus), num(v.incentive), num(v.other_allowance),
                num(v.pf), num(v.esi), num(v.professional_tax), num(v.income_tax),
                num(v.loan_deduction), num(v.advance_salary), num(v.other_deduction),
                num(v.employer_pf), num(v.employer_esi), num(v.employer_contribution),
                gross, totalDeductions, allowances, deductions, net
            ]
        );

        const payslip = result.rows[0];

        // Auto-email the employee using their personal email ONLY (never the official/work email).
        let email_sent = null;
        const empResult = await query(
            'SELECT personal_email FROM employees WHERE id = $1',
            [employee_id]
        );
        if (empResult.rows.length > 0 && empResult.rows[0].personal_email) {
            const empEmail = empResult.rows[0].personal_email;
            let pdfBuffer = pdfFromBase64(v.pdfBase64);
            if (!pdfBuffer) {
                const row = await fetchPayslipWithProfile(payslip.id, req.user.id, true);
                if (row) pdfBuffer = await renderPayslipPdf(row, row.company);
            }
            if (pdfBuffer) {
                const filename = `payslip_${payslip.employee_id}_${month}_${year}.pdf`;
                email_sent = await sendPayslipEmail(empEmail, filename, pdfBuffer);
            }
        }

        res.json({ success: true, payslip, email_sent });
    } catch (error) {
        console.error('Generate payroll error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   POST /api/payroll/generate-bulk
// @desc    Batch-generate processed payslips for multiple employees and email each
// @access  Admin
router.post('/generate-bulk', verifyToken, isAdmin, async (req, res) => {
    try {
        const items = req.body.items;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'No payslip items provided' });
        }

        const results = [];
        let created = 0;
        let emailed = 0;
        let failed = 0;

        for (const v of items) {
            try {
                const employee_id = v.employee_id;
                const month = parseInt(v.month, 10);
                const year = parseInt(v.year, 10);
                if (!employee_id || !month || !year) { failed++; results.push({ employee_id, ok: false, reason: 'Invalid employee/month/year' }); continue; }

                const totals = computeTotals(v);
                const gross = totals.gross;
                const totalDeductions = totals.totalDeductions;
                const net = totals.net;
                const allowances = gross - num(v.basic_salary);
                const deductions = totalDeductions;

                const result = await query(
                    `INSERT INTO payroll (
                        employee_id, month, year, working_days, present_days, leave_days, lop_days,
                        basic_salary, hra, conveyance, medical, special_allowance, bonus, incentive, other_allowance,
                        pf, esi, professional_tax, income_tax, loan_deduction, advance_salary, other_deduction,
                        employer_pf, employer_esi, employer_contribution,
                        gross_salary, total_deductions, allowances, deductions, net_salary, status
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22,
                        $23, $24, $25,
                        $26, $27, $28, $29, $30, 'processed'
                    )
                    ON CONFLICT (employee_id, month, year) DO UPDATE SET
                        working_days = $4, present_days = $5, leave_days = $6, lop_days = $7,
                        basic_salary = $8, hra = $9, conveyance = $10, medical = $11, special_allowance = $12,
                        bonus = $13, incentive = $14, other_allowance = $15,
                        pf = $16, esi = $17, professional_tax = $18, income_tax = $19, loan_deduction = $20,
                        advance_salary = $21, other_deduction = $22,
                        employer_pf = $23, employer_esi = $24, employer_contribution = $25,
                        gross_salary = $26, total_deductions = $27, allowances = $28, deductions = $29,
                        net_salary = $30, status = 'processed', updated_at = NOW()
                    RETURNING id`,
                    [
                        employee_id, month, year,
                        parseInt(v.working_days) || 0, parseInt(v.present_days) || 0,
                        parseInt(v.leave_days) || 0, parseInt(v.lop_days) || 0,
                        num(v.basic_salary), num(v.hra), num(v.conveyance), num(v.medical),
                        num(v.special_allowance), num(v.bonus), num(v.incentive), num(v.other_allowance),
                        num(v.pf), num(v.esi), num(v.professional_tax), num(v.income_tax),
                        num(v.loan_deduction), num(v.advance_salary), num(v.other_deduction),
                        num(v.employer_pf), num(v.employer_esi), num(v.employer_contribution),
                        gross, totalDeductions, allowances, deductions, net
                    ]
                );
                created++;

                // Email each employee using their personal email ONLY (never the official/work email).
                let email_sent = false;
                const empResult = await query(
                    'SELECT personal_email FROM employees WHERE id = $1',
                    [employee_id]
                );
                if (empResult.rows.length > 0 && empResult.rows[0].personal_email) {
                    let pdfBuffer = pdfFromBase64(v.pdfBase64);
                    if (!pdfBuffer) {
                        const row = await fetchPayslipWithProfile(result.rows[0].id, req.user.id, true);
                        if (row) pdfBuffer = await renderPayslipPdf(row, row.company);
                    }
                    if (pdfBuffer) {
                        const filename = `payslip_${employee_id}_${month}_${year}.pdf`;
                        const sent = await sendPayslipEmail(empResult.rows[0].email, filename, pdfBuffer);
                        if (sent.success) { emailed++; email_sent = true; }
                    }
                }
                results.push({ employee_id, ok: true, email_sent });
            } catch (e) {
                failed++;
                results.push({ employee_id: v.employee_id, ok: false, reason: e.message });
            }
        }

        res.json({ success: true, created, emailed, failed, results });
    } catch (error) {
        console.error('Bulk generate payroll error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// @route   DELETE /api/payroll/:id
// @desc    Delete a payslip
// @access  Admin
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const result = await query('DELETE FROM payroll WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Payslip not found' });
        }
        res.json({ success: true, message: 'Payslip deleted successfully' });
    } catch (error) {
        console.error('Delete payslip error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
