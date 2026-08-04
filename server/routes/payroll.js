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

// Compute totals matching the payslip layout:
//   A = Earnings (basic + allowances), B = Deductions, C = Bonus (incl. extra work),
//   D = Employer contributions, Net = A + C - B - D.
function computeTotals(v) {
    const gross = num(v.basic_salary) + num(v.hra) + num(v.conveyance) + num(v.medical)
        + num(v.special_allowance) + num(v.other_allowance);
    const totalDeductions = num(v.pf) + num(v.esi) + num(v.professional_tax) + num(v.income_tax)
        + num(v.loan_deduction) + num(v.advance_salary) + num(v.other_deduction);
    const bonus = num(v.bonus) + num(v.incentive) + num(v.extra_work);
    const employerTotal = num(v.employer_pf) + num(v.employer_esi) + num(v.employer_contribution);
    const net = gross + bonus - totalDeductions - employerTotal;
    return { gross, totalDeductions, bonus, employerTotal, net };
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
// Layout matches the designer reference: purple (#7c6ca8) header with logo + divider +
// PAYSLIP badge, section bars, 4-col employee table, Earnings (A) / Deductions (B),
// summary cards Gross (A) / Deductions (B) / Net, words, Attendance + Bonus (C),
// Employer Contributions, footer with signature. Single A4 page.
async function renderPayslipPdf(p, company) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 0 });
            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const PW = doc.page.width;
            const ML = 40;
            const CW = PW - 80;

            if (fontsReady) {
                doc.registerFont('Roboto', path.join(FONT_DIR, 'Roboto-Regular.ttf'));
                doc.registerFont('Roboto-Bold', path.join(FONT_DIR, 'Roboto-Bold.ttf'));
            }

            const PURPLE = '#7c6ca8';
            const DARK = '#38286b';
            const BORDER = '#d5cee6';
            const BAR = '#e5e0f5';
            const CARD = '#fbfbfd';
            const TOTAL = '#efeafb';
            const DED = '#d97706';
            const NET = '#2e7d32';
            const BODY = '#222222';

            const sectionBar = (title, x, y, w) => {
                doc.rect(x, y, w, 18).fill(BAR);
                doc.fill(DARK).font(FONT_BOLD).fontSize(8).text(title, x + 8, y + 4);
                return y + 18;
            };

            // ---- Header: logo | divider | company info + PAYSLIP badge ----
            let y = 16;
            const badgeW = 96;
            const badgeX = PW - ML - badgeW;
            const tx = ML + 150 + 14;
            const infoW = badgeX - tx - 16;

            if (company.logo) {
                try {
                    const logoPath = path.isAbsolute(company.logo)
                        ? company.logo
                        : path.join(__dirname, '../../public', company.logo.replace(/^\/+/, ''));
                    if (fs.existsSync(logoPath)) {
                        doc.image(logoPath, ML, y, { height: 46 });
                    }
                } catch (e) { /* logo is optional - fall back to text only */ }
            }

            doc.fill(DARK).font(FONT_BOLD).fontSize(12).text(p.company_name || company.name || 'Gensar IT Solutions', tx, y, { width: infoW });
            const hlines = [];
            if (company.address) hlines.push(company.address);
            if (company.phone) hlines.push(`Phone: ${company.phone}`);
            if (company.email) hlines.push(`Email: ${company.email}`);
            if (company.website) hlines.push(`Web: ${company.website}`);
            doc.font(FONT_REG).fontSize(7.5).fill('#555555');
            let iy = y + 17;
            hlines.forEach(l => {
                const h = doc.heightOfString(l, { width: infoW });
                doc.text(l, tx, iy, { width: infoW });
                iy += h + 2;
            });

            const divH = Math.max(iy - y, 60);
            doc.rect(ML + 146, y, 1, divH).fill(PURPLE);

            doc.strokeColor(BORDER).lineWidth(1);
            doc.roundedRect(badgeX, y, badgeW, 58, 5).stroke();
            doc.rect(badgeX + 0.5, y + 0.5, badgeW - 1, 24).fill(PURPLE);
            doc.fill('#FFFFFF').font(FONT_BOLD).fontSize(13).text('PAYSLIP', badgeX, y + 6, { width: badgeW, align: 'center' });
            doc.fill(DARK).font(FONT_BOLD).fontSize(10).text(`${MONTHS[p.month] || ''} ${p.year}`, badgeX, y + 30, { width: badgeW, align: 'center' });

            doc.rect(ML, y + divH + 10, CW, 1.5).fill(PURPLE);
            y += divH + 22;

            // ---- Employee details (4-col table, 7 rows) ----
            y = sectionBar('EMPLOYEE DETAILS', ML, y, CW);
            const colW = CW / 2;
            const lblW = 92;
            const empLeft = [
                ['Employee ID', p.emp_id || '-'],
                ['Employee Name', `${p.first_name || ''} ${p.last_name || ''}`.trim() || '-'],
                ['Designation', p.designation_name || '-'],
                ['Department', p.department_name || '-'],
                ['Date of Joining', formatDateOnly(p.joining_date)],
                ['PAN Number', p.pan_number || '-'],
                ['UAN Number', p.uan_number || '-']
            ];
            const empRight = [
                ['Pay Period', `${MONTHS[p.month] || ''} ${p.year}`],
                ['Working Days', p.working_days || 0],
                ['Present Days', p.present_days || 0],
                ['Leave Days', p.leave_days || 0],
                ['LOP Days', p.lop_days || 0],
                ['Bank Account No', p.bank_account || '-'],
                ['Bank Name', p.bank_name || '-']
            ];
            const t0 = y;
            const rowH = 16;
            for (let i = 0; i < 7; i++) {
                doc.fill('#666666').font(FONT_REG).fontSize(7.5).text(empLeft[i][0], ML, y + 3);
                doc.fill(BODY).font(FONT_BOLD).text(String(empLeft[i][1]), ML + lblW, y + 3, { width: colW - lblW - 8 });
                doc.fill('#666666').font(FONT_REG).text(empRight[i][0], ML + colW, y + 3);
                doc.fill(BODY).font(FONT_BOLD).text(String(empRight[i][1]), ML + colW + lblW, y + 3, { width: colW - lblW - 8 });
                doc.strokeColor(BORDER).lineWidth(0.5).moveTo(ML, y + rowH).lineTo(ML + CW, y + rowH).stroke();
                y += rowH;
            }
            doc.strokeColor(BORDER).lineWidth(0.8).rect(ML, t0, CW, 7 * rowH).stroke();
            y += 12;

            // ---- Earnings (A) / Deductions (B) tables ----
            const halfW = (CW - 12) / 2;
            const drawMoneyTable = (x, title, rows, total, totalLabel, baseY) => {
                let ty = baseY;
                doc.rect(x, ty, halfW, 18).fill(BAR);
                doc.fill(DARK).font(FONT_BOLD).fontSize(8).text(title, x + 8, ty + 4);
                doc.fill(DARK).text('AMOUNT (₹)', x + halfW - 8, ty + 4, { align: 'right' });
                ty += 18;
                const r0 = ty;
                rows.forEach(([k, v]) => {
                    doc.fill(BODY).font(FONT_REG).fontSize(7.5).text(k, x + 8, ty + 3);
                    doc.font(FONT_BOLD).text(formatINR(v), x + halfW - 8, ty + 3, { align: 'right' });
                    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(x, ty + 14).lineTo(x + halfW, ty + 14).stroke();
                    ty += 14;
                });
                doc.rect(x, ty, halfW, 18).fill(TOTAL);
                doc.fill(DARK).font(FONT_BOLD).fontSize(8).text(totalLabel, x + 8, ty + 4);
                doc.font(FONT_BOLD).text(formatINR(total), x + halfW - 8, ty + 4, { align: 'right' });
                doc.strokeColor(BORDER).lineWidth(0.8).rect(x, r0, halfW, (ty + 18) - r0).stroke();
                ty += 18;
                return ty;
            };

            const earningsRows = [
                ['Basic Salary', num(p.basic_salary)],
                ['HRA', num(p.hra)],
                ['Conveyance', num(p.conveyance)],
                ['Medical Allowance', num(p.medical)],
                ['Special Allowance', num(p.special_allowance)],
                ['Other Allowance', num(p.other_allowance)]
            ];
            const deductionRows = [
                ['Employee PF', num(p.pf)],
                ['Employee ESI', num(p.esi)],
                ['Professional Tax', num(p.professional_tax)],
                ['Income Tax', num(p.income_tax)],
                ['Loan Deduction', num(p.loan_deduction)],
                ['Advance Salary', num(p.advance_salary)],
                ['Other Deduction', num(p.other_deduction)]
            ];
            const eyE = drawMoneyTable(ML, 'EARNINGS (A)', earningsRows, num(p.gross_salary), 'TOTAL EARNINGS (A)', y);
            const eyD = drawMoneyTable(ML + halfW + 12, 'DEDUCTIONS (B)', deductionRows, num(p.total_deductions), 'TOTAL DEDUCTIONS (B)', y);
            y = Math.max(eyE, eyD) + 12;

            // ---- Summary cards: Gross (A) / Deductions (B) / Net Payable (A+C-B-D) ----
            const cardW = (CW - 24) / 3;
            const cards = [
                { label: 'GROSS SALARY (A)', value: num(p.gross_salary), color: DARK },
                { label: 'TOTAL DEDUCTIONS (B)', value: num(p.total_deductions), color: DED },
                { label: 'NET SALARY PAYABLE (A + C - B - D)', value: num(p.net_salary), color: NET }
            ];
            let cx = ML;
            cards.forEach(card => {
                doc.rect(cx, y, cardW, 42).fill(CARD);
                doc.strokeColor(BORDER).lineWidth(0.8).rect(cx, y, cardW, 42).stroke();
                doc.fill(card.color).font(FONT_BOLD).fontSize(7).text(card.label, cx + 4, y + 5, { width: cardW - 8, align: 'center' });
                doc.font(FONT_BOLD).fontSize(12).text(formatINR(card.value), cx + 4, y + 20, { width: cardW - 8, align: 'center' });
                cx += cardW + 12;
            });
            y += 42 + 12;

            // ---- Net salary in words ----
            doc.rect(ML, y, CW, 24).fill(TOTAL);
            doc.fill(DARK).font(FONT_BOLD).fontSize(8).text('NET SALARY IN WORDS', ML + 10, y + 4);
            doc.fill(BODY).font(FONT_REG).fontSize(8).text(amountToWords(num(p.net_salary)), ML + 10, y + 13);
            y += 24 + 12;

            // ---- Attendance summary + Bonus (C) ----
            y = sectionBar('ATTENDANCE SUMMARY', ML, y, halfW);
            sectionBar('BONUS (C)', ML + halfW + 12, y, halfW);
            const attRows = [
                ['Working Days', p.working_days || 0],
                ['Present Days', p.present_days || 0],
                ['Leave Days', p.leave_days || 0],
                ['LOP Days', p.lop_days || 0]
            ];
            const bonusRows = [
                ['Incentive', num(p.incentive)],
                ['Attendance Incentive', num(p.bonus)],
                ['Extra Work', num(p.extra_work)]
            ];
            const totalBonus = num(p.bonus) + num(p.incentive) + num(p.extra_work);
            let ay = y;
            const a0 = ay;
            attRows.forEach(([k, v]) => {
                doc.fill(BODY).font(FONT_REG).fontSize(7.5).text(k, ML + 8, ay + 3);
                doc.font(FONT_BOLD).text(String(v), ML + halfW - 8, ay + 3, { align: 'right' });
                doc.strokeColor(BORDER).lineWidth(0.5).moveTo(ML, ay + 14).lineTo(ML + halfW, ay + 14).stroke();
                ay += 14;
            });
            doc.strokeColor(BORDER).lineWidth(0.8).rect(ML, a0, halfW, ay - a0).stroke();
            let by = y;
            const b0 = by;
            bonusRows.forEach(([k, v]) => {
                doc.fill(BODY).font(FONT_REG).fontSize(7.5).text(k, ML + halfW + 20, by + 3);
                doc.font(FONT_BOLD).text(formatINR(v), ML + CW - 8, by + 3, { align: 'right' });
                doc.strokeColor(BORDER).lineWidth(0.5).moveTo(ML + halfW + 12, by + 14).lineTo(ML + CW, by + 14).stroke();
                by += 14;
            });
            doc.rect(ML + halfW + 12, by, halfW, 18).fill(TOTAL);
            doc.fill(DARK).font(FONT_BOLD).fontSize(8).text('TOTAL (C)', ML + halfW + 20, by + 4);
            doc.font(FONT_BOLD).text(formatINR(totalBonus), ML + CW - 8, by + 4, { align: 'right' });
            doc.strokeColor(BORDER).lineWidth(0.8).rect(ML + halfW + 12, b0, halfW, (by + 18) - b0).stroke();
            y = Math.max(ay, by + 18) + 12;

            // ---- Employer contributions (4 columns) ----
            y = sectionBar('EMPLOYER CONTRIBUTIONS', ML, y, CW);
            const ecol = CW / 4;
            const eheads = ['EMPLOYER PF', 'EMPLOYER ESI', 'EMPLOYER OTHER', 'TOTAL'];
            doc.rect(ML, y, CW, 16).fill(BAR);
            eheads.forEach((h, i) => { doc.fill(DARK).font(FONT_BOLD).fontSize(7).text(h, ML + i * ecol + 8, y + 4); });
            y += 16;
            const empTotal = num(p.employer_pf) + num(p.employer_esi) + num(p.employer_contribution);
            const evals = [
                formatINR(num(p.employer_pf)),
                formatINR(num(p.employer_esi)),
                formatINR(num(p.employer_contribution)),
                formatINR(empTotal)
            ];
            doc.rect(ML, y, CW, 18).fill(CARD);
            doc.rect(ML + 3 * ecol, y, ecol, 18).fill(TOTAL);
            evals.forEach((v, i) => { doc.fill(BODY).font(FONT_BOLD).fontSize(8).text(v, ML + i * ecol + 8, y + 5); });
            doc.strokeColor(BORDER).lineWidth(0.8).rect(ML, y - 16, CW, 34).stroke();
            y += 18 + 12;

            // ---- Footer: notes + signature ----
            y = Math.max(y, 760);
            doc.fill('#666666').font(FONT_REG).fontSize(7).text('This is a system generated payslip. No signature required.', ML, y);
            doc.fill('#999999').font(FONT_REG).fontSize(7).text(`Generated on ${new Date().toLocaleDateString('en-IN')}`, ML, y + 9);
            doc.fill(DARK).font(FONT_BOLD).fontSize(8).text('For ' + String(p.company_name || company.name || 'Gensar IT Solutions').toUpperCase(), PW - ML, y, { align: 'right' });
            doc.fill('#666666').font(FONT_REG).fontSize(7).text('Authorised Signatory', PW - ML, y + 9, { align: 'right' });

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
                basic_salary, hra, conveyance, medical, special_allowance, bonus, incentive, other_allowance, extra_work,
                pf, esi, professional_tax, income_tax, loan_deduction, advance_salary, other_deduction,
                employer_pf, employer_esi, employer_contribution,
                gross_salary, total_deductions, allowances, deductions, net_salary, status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21, $22, $23,
                $24, $25, $26,
                $27, $28, $29, $30, $31, 'processed'
            )
            ON CONFLICT (employee_id, month, year) DO UPDATE SET
                working_days = $4, present_days = $5, leave_days = $6, lop_days = $7,
                basic_salary = $8, hra = $9, conveyance = $10, medical = $11, special_allowance = $12,
                bonus = $13, incentive = $14, other_allowance = $15, extra_work = $16,
                pf = $17, esi = $18, professional_tax = $19, income_tax = $20, loan_deduction = $21,
                advance_salary = $22, other_deduction = $23,
                employer_pf = $24, employer_esi = $25, employer_contribution = $26,
                gross_salary = $27, total_deductions = $28, allowances = $29, deductions = $30,
                net_salary = $31, status = 'processed', updated_at = NOW()
            RETURNING *`,
            [
                employee_id, month, year,
                parseInt(v.working_days) || 0, parseInt(v.present_days) || 0,
                parseInt(v.leave_days) || 0, parseInt(v.lop_days) || 0,
                num(v.basic_salary), num(v.hra), num(v.conveyance), num(v.medical),
                num(v.special_allowance), num(v.bonus), num(v.incentive), num(v.other_allowance),
                num(v.extra_work),
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
                        basic_salary, hra, conveyance, medical, special_allowance, bonus, incentive, other_allowance, extra_work,
                        pf, esi, professional_tax, income_tax, loan_deduction, advance_salary, other_deduction,
                        employer_pf, employer_esi, employer_contribution,
                        gross_salary, total_deductions, allowances, deductions, net_salary, status
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14, $15, $16,
                        $17, $18, $19, $20, $21, $22, $23,
                        $24, $25, $26,
                        $27, $28, $29, $30, $31, 'processed'
                    )
                    ON CONFLICT (employee_id, month, year) DO UPDATE SET
                        working_days = $4, present_days = $5, leave_days = $6, lop_days = $7,
                        basic_salary = $8, hra = $9, conveyance = $10, medical = $11, special_allowance = $12,
                        bonus = $13, incentive = $14, other_allowance = $15, extra_work = $16,
                        pf = $17, esi = $18, professional_tax = $19, income_tax = $20, loan_deduction = $21,
                        advance_salary = $22, other_deduction = $23,
                        employer_pf = $24, employer_esi = $25, employer_contribution = $26,
                        gross_salary = $27, total_deductions = $28, allowances = $29, deductions = $30,
                        net_salary = $31, status = 'processed', updated_at = NOW()
                    RETURNING id`,
                    [
                        employee_id, month, year,
                        parseInt(v.working_days) || 0, parseInt(v.present_days) || 0,
                        parseInt(v.leave_days) || 0, parseInt(v.lop_days) || 0,
                        num(v.basic_salary), num(v.hra), num(v.conveyance), num(v.medical),
                        num(v.special_allowance), num(v.bonus), num(v.incentive), num(v.other_allowance),
                        num(v.extra_work),
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
                        const sent = await sendPayslipEmail(empResult.rows[0].personal_email, filename, pdfBuffer);
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
