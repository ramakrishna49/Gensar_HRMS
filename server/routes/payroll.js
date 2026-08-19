const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const PDFDocument = require('pdfkit');
const { query } = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { sendPayslipEmail } = require('../services/email');

const PP_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
//   D = Employer contributions, Net = Gross - LOP deduction + C - (B + D).
function computeTotals(v) {
    const componentGross = num(v.basic_salary) + num(v.hra) + num(v.conveyance)
        + num(v.special_allowance) + num(v.other_allowance);
    const gross = num(v.monthly_gross) > 0 ? num(v.monthly_gross) : componentGross;
    const totalDeductions = num(v.pf) + num(v.esi) + num(v.professional_tax) + num(v.income_tax)
        + num(v.other_deduction);
    const bonus = num(v.bonus) + num(v.incentive) + num(v.extra_work);
    const employerTotal = num(v.employer_pf) + num(v.employer_esi) + num(v.employer_contribution);
    const workingDays = num(v.working_days);
    const presentDays = num(v.present_days);
    const leaveDays = num(v.leave_days);
    const lopDays = num(v.lop_days);
    const paidDays = presentDays + leaveDays;
    const attendanceValid = Math.abs(workingDays - (presentDays + leaveDays + lopDays)) < 0.001;
    const actualPayableGross = gross - totalDeductions + bonus;
    const totalDeductionsWithEmployer = totalDeductions + employerTotal;
    const netPayable = actualPayableGross - employerTotal;
    const perDaySalary = workingDays > 0 ? netPayable / workingDays : 0;
    const lopDeduction = perDaySalary * lopDays;
    const net = netPayable - lopDeduction;
    return { gross, totalDeductions, totalDeductionsWithEmployer, bonus, employerTotal, workingDays, presentDays, leaveDays, lopDays, paidDays, actualPayableGross, netPayable, perDaySalary, lopDeduction, attendanceValid, net };
}

// Download a remote image (HTTP/HTTPS) to a temp file path, returns the local path or null.
function downloadLogoToTemp(url) {
    return new Promise((resolve) => {
        try {
            const client = url.startsWith('https') ? https : http;
            const tmpPath = path.join(__dirname, '..', 'assets', 'fonts', '_logo_tmp.png');
            client.get(url, { timeout: 5000 }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return downloadLogoToTemp(res.headers.location).then(resolve);
                }
                if (res.statusCode !== 200) { resolve(null); return; }
                const file = fs.createWriteStream(tmpPath);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(tmpPath); });
                file.on('error', () => { resolve(null); });
            }).on('error', () => { resolve(null); });
        } catch (e) { resolve(null); }
    });
}

async function getProfileSalaryValues(employeeId, values) {
    const result = await query(
        `SELECT salary, basic_salary, hra, conveyance, special_allowance, other_allowance,
                pf, esi, professional_tax, income_tax, other_deduction,
                employer_pf, employer_esi, employer_contribution
         FROM employees WHERE id = $1`,
        [employeeId]
    );
    if (result.rows.length === 0) return null;
    const profile = result.rows[0];
    return {
        ...values,
        basic_salary: num(profile.basic_salary) || num(profile.salary),
        hra: num(profile.hra),
        conveyance: num(profile.conveyance),
        medical: 0,
        special_allowance: num(profile.special_allowance),
        other_allowance: num(profile.other_allowance),
        pf: num(profile.pf),
        esi: num(profile.esi),
        professional_tax: num(profile.professional_tax),
        income_tax: num(profile.income_tax),
        loan_deduction: 0,
        advance_salary: 0,
        other_deduction: num(profile.other_deduction),
        employer_pf: num(profile.employer_pf),
        employer_esi: num(profile.employer_esi),
        employer_contribution: num(profile.employer_contribution),
        monthly_gross: num(profile.basic_salary) + num(profile.hra) + num(profile.conveyance)
            + num(profile.special_allowance) + num(profile.other_allowance)
    };
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
// Layout matches the designer reference exactly: 794px container (A4 @96dpi), purple #7c6ca8 border,
// header with logo+divider+badge, section bars with left purple border,
// 4-col employee table, Earnings (A) / Deductions (B) side-by-side,
// summary cards (white bg, border), net salary in words (single line, italic),
// Attendance + Bonus (C) bottom row, Employer Contributions single column,
// footer with notes + signature. Single A4 page.
async function renderPayslipPdf(p, company) {
    // Resolve logo path before entering the synchronous PDF generation
    const logo = (company && company.logo) || '/assets/images/gensar_logo.png';
    let resolvedLogoPath = null;
    try {
        if (/^https?:\/\//i.test(logo)) {
            resolvedLogoPath = await downloadLogoToTemp(logo);
        } else {
            // logo is always a web-relative path (e.g. /assets/images/gensar_logo.png),
            // not a filesystem path. Always resolve against the public/ directory.
            const lp = path.join(__dirname, '../../public', logo.replace(/^\/+/, ''));
            if (fs.existsSync(lp)) resolvedLogoPath = lp;
        }
    } catch (e) { /* logo is optional */ }

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 0 });
            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Reference template is 794px wide (A4 @96dpi). Scale every metric by S = A4_width / 794
            // so the PDF output matches the reference HTML layout proportionally.
            const PW = doc.page.width;
            const S = PW / 794;
            const ML = 29 * S;
            const CW = 736 * S;
            const PAD_TOP = 22 * S;
            const ROW = 24.14 * S;
            const BAR_H = 26 * S;
            const F = (px) => px * S;
            const plainINR = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
            const FL = FONT_REG;
            const FB = FONT_BOLD;

            const centerY = (y, h, fontPx) => y + (h - F(fontPx)) / 2;

            const sectionBar = (title, x, y, w) => {
                const h = BAR_H;
                doc.rect(x, y, 4 * S, h).fill(PURPLE);
                doc.rect(x + 4 * S, y, w - 4 * S, h).fill(BAR);
                doc.strokeColor(BORDER).lineWidth(0.5 * S).rect(x, y, w, h).stroke();
                doc.fill(DARK).font(FB).fontSize(F(11.5)).text(title, x + 10 * S, centerY(y, h, 11.5));
                return y + h;
            };

            // Financial table (header row, data rows, total row) matching the reference.
            const finTable = (x, title, rows, totalLabel, total, baseY, tableW) => {
                const w = tableW || (CW - 12 * S) / 2;
                const AMT_W = 95 * S;
                const vcol = x + w - AMT_W;
                let ty = baseY;
                const headerText = (txt, x0, w0, right) => {
                    doc.fill(DARK).font(FB).fontSize(F(11.5));
                    doc.text(txt, x0 + 10 * S, centerY(ty, ROW, 11.5), { width: w0 - 20 * S, align: right ? 'right' : 'left' });
                };
                doc.rect(x, ty, w, ROW).fill(BAR);
                headerText(title, x, vcol - x, false);
                headerText('AMOUNT (\u20B9)', vcol, AMT_W, true);
                doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(x, ty + ROW).lineTo(x + w, ty + ROW).stroke();
                doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(vcol, ty).lineTo(vcol, ty + ROW).stroke();
                ty += ROW;
                rows.forEach(([k, v]) => {
                    doc.fill(BODY).font(FL).fontSize(F(11.5)).text(k, x + 10 * S, centerY(ty, ROW, 11.5), { width: vcol - x - 20 * S });
                    doc.font(FB).text(plainINR(v), vcol + 10 * S, centerY(ty, ROW, 11.5), { width: AMT_W - 20 * S, align: 'right' });
                    doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(x, ty + ROW).lineTo(x + w, ty + ROW).stroke();
                    doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(vcol, ty).lineTo(vcol, ty + ROW).stroke();
                    ty += ROW;
                });
                doc.rect(x, ty, w, ROW).fill(TOTAL);
                doc.fill(DARK).font(FB).fontSize(F(11.5)).text(totalLabel, x + 10 * S, centerY(ty, ROW, 11.5), { width: vcol - x - 20 * S });
                doc.text(plainINR(total), vcol + 10 * S, centerY(ty, ROW, 11.5), { width: AMT_W - 20 * S, align: 'right' });
                doc.strokeColor(BORDER).lineWidth(0.8 * S).rect(x, ty, w, ROW).stroke();
                ty += ROW;
                doc.strokeColor(BORDER).lineWidth(0.5 * S).rect(x, baseY, w, ty - baseY).stroke();
                return ty;
            };

            // ---- Container border ----
            doc.strokeColor(PURPLE).lineWidth(1 * S).rect(0, 0, PW, doc.page.height).stroke();

            let y = PAD_TOP;

            // ---- Header: logo | divider | company info + PAYSLIP badge ----
            const badgeW = 150 * S;
            const badgeX = ML + CW - badgeW;
            const logoW = 175 * S;
            if (resolvedLogoPath) {
                try { doc.image(resolvedLogoPath, ML, y, { width: logoW }); } catch (e) { /* logo is optional */ }
            }

            const divX = ML + logoW + 15 * S;
            doc.rect(divX, y, 1, 95 * S).fill(PURPLE);

            const infoX = divX + 5 * S + 1 * S + 15 * S;
            const infoW = badgeX - infoX - 10 * S;
            doc.fill('#111111').font(FB).fontSize(F(19)).text('GENSAR IT SOLUTIONS PVT. LTD.', infoX, y, { width: infoW });
            let iy = y + F(19) * 1.25 + 5 * S;
            doc.font(FL).fontSize(F(10.5)).fill('#222222');
            ['Manjeera Trinity Corporate, 4th Floor, #402, KPHB, Kukatpally,',
                'Hyderabad, 500072, Telangana, India',
                'E-Mail: hr@gensarit.com',
                'Ph No: +91 9121912138'].forEach(l => {
                doc.text(l, infoX, iy, { width: infoW });
                iy += F(10.5) * 1.25 + 3 * S;
            });

            const bH = 31 * S;
            const bhH = bH / 2;
            doc.strokeColor(BORDER).lineWidth(1 * S);
            doc.roundedRect(badgeX, y, badgeW, bH, 6 * S).stroke();
            doc.rect(badgeX, y, badgeW, bhH).fill(PURPLE);
            doc.fill('#FFFFFF').font(FB).fontSize(F(15)).text('PAYSLIP', badgeX, centerY(y, bhH, 15), { width: badgeW, align: 'center' });
            doc.fill('#111111').font(FB).fontSize(F(13.5)).text(`${PP_MONTHS[p.month] || ''} ${p.year}`, badgeX, centerY(y + bhH, bhH, 13.5), { width: badgeW, align: 'center' });

            const divH = Math.max(iy - y, 95 * S);
            doc.rect(divX, y, 1, divH).fill(PURPLE);

            y += divH + 16 * S;
            doc.strokeColor(PURPLE).lineWidth(2 * S).moveTo(ML, y).lineTo(ML + CW, y).stroke();
            y += 2 * S + 16 * S;

            // ---- Employee details (4 equal columns) ----
            y = sectionBar('EMPLOYEE DETAILS', ML, y, CW) + 8 * S;
            const colW = CW / 4;
            const empCells = [
                ['Employee ID', p.emp_id || '-'],
                ['Pay Period', `${PP_MONTHS[p.month] || ''} ${p.year}`],
                ['Employee Name', `${p.first_name || ''} ${p.last_name || ''}`.trim() || '-'],
                ['Working Days', p.working_days || 0],
                ['Designation', p.designation_name || '-'],
                ['Present Days', p.present_days || 0],
                ['Department', p.department_name || '-'],
                ['Leave Days', p.leave_days || 0],
                ['Date of Joining', formatDateOnly(p.joining_date)],
                ['LOP Days', p.lop_days || 0],
                ['PAN Number', p.pan_number || '-'],
                ['Bank Account No.', p.bank_account || '-'],
                ['UAN Number', p.uan_number || '-'],
                ['Bank Name', p.bank_name || '-']
            ];
            const t0 = y;
            const ecol = (ci) => ML + ci * colW;
            for (let r = 0; r < 7; r++) {
                const rowBg = r % 2 === 0 ? '#fbf9fc' : '#FFFFFF';
                doc.fill(rowBg).rect(ML, y, CW, ROW).fill();
                for (let c = 0; c < 4; c++) {
                    const pair = empCells[r * 2 + Math.floor(c / 2)];
                    const isVal = c % 2 === 1;
                    doc.fill(isVal ? BODY : '#333333').font(isVal ? FB : FL).fontSize(F(11.5));
                    doc.text(String(pair[isVal ? 1 : 0]), ecol(c) + 10 * S, centerY(y, ROW, 11.5), { width: colW - 20 * S });
                    if (c < 3) {
                        doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(ecol(c + 1), y).lineTo(ecol(c + 1), y + ROW).stroke();
                    }
                }
                doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(ML, y + ROW).lineTo(ML + CW, y + ROW).stroke();
                y += ROW;
            }
            doc.strokeColor(BORDER).lineWidth(0.8 * S).rect(ML, t0, CW, 7 * ROW).stroke();
            y += 12 * S;

            // ---- Earnings (A) / Deductions (B) tables ----
            const totals = computeTotals(p);
            const earningsRows = [
                ['Basic Salary', num(p.basic_salary)],
                ['HRA', num(p.hra)],
                ['Conveyance Allowance', num(p.conveyance)],
                ['Medical Allowance', num(p.other_allowance)],
                ['Special Allowance', num(p.special_allowance)]
            ];
            const deductionRows = [
                ['PF Contribution', num(p.pf)],
                ['ESI Contribution', num(p.esi)],
                ['Professional Tax', num(p.professional_tax)],
                ['Income Tax', num(p.income_tax)],
                ['Other Deductions', num(p.other_deduction)]
            ];
            const halfW = (CW - 12 * S) / 2;
            const eyE = finTable(ML, 'EARNINGS', earningsRows, 'TOTAL EARNINGS (A)', totals.gross, y);
            const eyD = finTable(ML + halfW + 12 * S, 'DEDUCTIONS', deductionRows, 'TOTAL DEDUCTIONS (B)', totals.totalDeductions, y);
            y = Math.max(eyE, eyD) + 2 * S;

            // ---- Summary cards: Gross (A) / Deductions (B) / Net Payable (A+C-B-D) ----
            const cardW = (CW - 20 * S) / 3;
            const cards = [
                { label: 'GROSS SALARY (A)', value: totals.gross, color: DARK },
                { label: 'TOTAL DEDUCTIONS', value: totals.totalDeductionsWithEmployer, color: DED },
                { label: 'NET SALARY PAYABLE', value: totals.net, color: NET }
            ];
            let cx = ML;
            cards.forEach(card => {
                const ch = 65 * S;
                doc.roundedRect(cx, y, cardW, ch, 5 * S).fill(CARD);
                doc.strokeColor(BORDER).lineWidth(0.8 * S).roundedRect(cx, y, cardW, ch, 5 * S).stroke();
                const cPad = 8 * S;
                const labelFontSize = 13.5;
                const valueFontSize = 19;
                const labelMargin = 5;
                const textBlockH = F(labelFontSize) + F(labelMargin) + F(valueFontSize);
                const textOffset = (ch - cPad * 2 - textBlockH) / 2;
                const labelY = y + cPad + textOffset;
                doc.fill('#444444').font(FB).fontSize(F(labelFontSize)).text(card.label, cx + 5 * S, labelY, { width: cardW - 10 * S, align: 'center', lineBreak: false });
                doc.font(FB).fontSize(F(valueFontSize)).text('\u20B9 ' + plainINR(card.value), cx + 5 * S, labelY + F(labelFontSize) + F(labelMargin), { width: cardW - 10 * S, align: 'center' });
                cx += cardW + 10 * S;
            });
            y += 65 * S + 10 * S;

            // ---- Net salary in words ----
            const wH = 28 * S;
            doc.rect(ML, y, CW, wH).fill(CARD);
            doc.strokeColor(BORDER).lineWidth(0.8 * S).rect(ML, y, CW, wH).stroke();
            const wordsLabel = 'NET SALARY IN WORDS:';
            const labelW = doc.font(FB).fontSize(F(11.5)).widthOfString(wordsLabel);
            doc.fill(DARK).font(FB).fontSize(F(11.5)).text(wordsLabel, ML + 12 * S, centerY(y, wH, 11.5));
            doc.fill(BODY).font(FL).fontSize(F(11.5)).text(amountToWords(totals.net), ML + 12 * S + labelW + 12 * S, centerY(y, wH, 11.5), { width: CW - 24 * S - labelW - 12 * S });
            y += wH + 12 * S;

            // ---- Attendance summary (4-col) + Bonus (C) side by side ----
            const attX = ML;
            const attW = 0.46 * CW;
            const rowGap = 20 * S;
            const bnsX = ML + attW + rowGap;
            const bnsW = CW - attW - rowGap;
            const attBarY = y;
            const attBarH = BAR_H - 2 * S; // reference bar has no bottom border here
            const attValueH = 26 * S;
            const attHeadH = 4 * ROW - attBarH - attValueH;
            doc.rect(attX, attBarY, 4 * S, attBarH).fill(PURPLE);
            doc.rect(attX + 4 * S, attBarY, attW - 4 * S, attBarH).fill(BAR);
            doc.fill(DARK).font(FB).fontSize(F(11.5)).text('ATTENDANCE SUMMARY', attX + 10 * S, centerY(attBarY, attBarH, 11.5));

            const attColW = attW / 4;
            const attHeads = ['Working Days', 'Present Days', 'Leave Days', 'LOP Days'];
            const attVals = [p.working_days || 0, p.present_days || 0, p.leave_days || 0, p.lop_days || 0];
            let ay = attBarY + attBarH;
            doc.fill(BAR);
            for (let c = 0; c < 4; c++) {
                doc.rect(attX + c * attColW, ay, attColW, attHeadH).fill();
                doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(attX + c * attColW, ay).lineTo(attX + c * attColW, ay + attHeadH).stroke();
            }
            doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(attX, ay + attHeadH).lineTo(attX + attW, ay + attHeadH).stroke();
            attHeads.forEach((h, c) => {
                doc.fill(DARK).font(FB).fontSize(F(11.5)).text(h, attX + c * attColW, centerY(ay, attHeadH, 11.5), { width: attColW, align: 'center' });
            });
            ay += attHeadH;
            doc.fill('#FFFFFF').rect(attX, ay, attW, attValueH).fill();
            attVals.forEach((v, c) => {
                doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(attX + c * attColW, ay).lineTo(attX + c * attColW, ay + attValueH).stroke();
                doc.fill(BODY).font(FB).fontSize(F(11.5)).text(String(v), attX + c * attColW, centerY(ay, attValueH, 11.5), { width: attColW, align: 'center' });
            });
            doc.strokeColor(BORDER).lineWidth(0.5 * S).moveTo(attX, ay + attValueH).lineTo(attX + attW, ay + attValueH).stroke();
            ay += attValueH;

            const bonusRows = [
                ['Incentive', num(p.incentive)],
                ['Attendance Incentive', num(p.bonus)],
                ['Extra Work', num(p.extra_work)]
            ];
            const by = finTable(bnsX, 'BONUS (C)', bonusRows, 'TOTAL BONUS (C)', totals.bonus, attBarY, bnsW);
            y = Math.max(ay, by) + 2 * S;

            // ---- Employer Contributions (single column, full width finTable) ----
            const empTotal = totals.employerTotal;
            const eRows = [
                ['Employer PF Contribution', num(p.employer_pf)],
                ['Employer ESI Contribution', num(p.employer_esi)],
                ['Employer Other Contribution', num(p.employer_contribution)]
            ];
            y = finTable(ML, 'EMPLOYER CONTRIBUTIONS', eRows, 'TOTAL EMPLOYER CONTRIBUTION (D)', empTotal, y, CW) + 2 * S;

            // ---- Footer: notes + signature ----
            y += 8 * S;
            doc.strokeColor(BORDER).lineWidth(1 * S).moveTo(ML, y).lineTo(ML + CW, y).stroke();
            let fy = y + 6 * S;
            doc.fill('#555555').font(FB).fontSize(F(10.5)).text('Note:', ML, fy);
            doc.font(FL).text('\u2022 This is a computer generated payslip.', ML + 15 * S, fy);
            fy += 13 * S;
            doc.text('\u2022 No signature is required.', ML + 15 * S, fy);
            fy += 13 * S;
            doc.text('\u2022 Please contact HR for any discrepancies.', ML + 15 * S, fy);
            fy += 13 * S;

            const sigX = ML + CW - 170 * S;
            doc.fill(DARK).font(FB).fontSize(F(10.5)).text('For GENSAR IT SOLUTIONS PVT. LTD.', sigX, y + 6 * S, { width: 170 * S, align: 'right' });
            doc.fill('#555555').font(FL).fontSize(F(10.5)).text('This is a system generated document and does not require signature.', sigX, y + 27 * S, { width: 170 * S, align: 'right' });

            doc.end();
        } catch (err) {
            console.error('Render payslip PDF error:', err);
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

// @route   POST /api/payroll/render-pdf
// @desc    Render a PDF from payslip payload data (for unsaved / live preview downloads)
// @access  Private
router.post('/render-pdf', verifyToken, async (req, res) => {
    try {
        const p = req.body;
        if (!p) return res.status(400).json({ success: false, message: 'No payslip data' });
        const company = p.company || await getCompanyData();
        const buf = await renderPayslipPdf(p, company);
        const empId = p.emp_id || p.employee_id || 'emp';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=payslip_${empId}_${p.month || ''}_${p.year || ''}.pdf`);
        res.send(buf);
    } catch (error) {
        console.error('Render PDF error:', error);
        res.status(500).json({ success: false, message: 'PDF generation failed' });
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

        const payrollValues = await getProfileSalaryValues(employee_id, v);
        if (!payrollValues) {
            return res.status(404).json({ success: false, message: 'Employee profile not found' });
        }
        const totals = computeTotals(payrollValues);
        if (!totals.attendanceValid) {
            return res.status(400).json({ success: false, message: 'Attendance calculation is incorrect.' });
        }
        const gross = totals.gross;
        const totalDeductions = totals.totalDeductions;
        const net = totals.net;
        // Keep legacy columns in sync for older report code.
        const allowances = gross - num(payrollValues.basic_salary);
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
                num(payrollValues.basic_salary), num(payrollValues.hra), num(payrollValues.conveyance), num(payrollValues.medical),
                num(payrollValues.special_allowance), num(payrollValues.bonus), num(payrollValues.incentive), num(payrollValues.other_allowance),
                num(payrollValues.extra_work),
                num(payrollValues.pf), num(payrollValues.esi), num(payrollValues.professional_tax), num(payrollValues.income_tax),
                num(payrollValues.loan_deduction), num(payrollValues.advance_salary), num(payrollValues.other_deduction),
                num(payrollValues.employer_pf), num(payrollValues.employer_esi), num(payrollValues.employer_contribution),
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

                const payrollValues = await getProfileSalaryValues(employee_id, v);
                if (!payrollValues) {
                    failed++;
                    results.push({ employee_id, ok: false, reason: 'Employee profile not found' });
                    continue;
                }
                const totals = computeTotals(payrollValues);
                if (!totals.attendanceValid) {
                    failed++;
                    results.push({ employee_id, ok: false, reason: 'Attendance calculation is incorrect.' });
                    continue;
                }
                const gross = totals.gross;
                const totalDeductions = totals.totalDeductions;
                const net = totals.net;
                const allowances = gross - num(payrollValues.basic_salary);
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
                        num(payrollValues.basic_salary), num(payrollValues.hra), num(payrollValues.conveyance), num(payrollValues.medical),
                        num(payrollValues.special_allowance), num(payrollValues.bonus), num(payrollValues.incentive), num(payrollValues.other_allowance),
                        num(payrollValues.extra_work),
                        num(payrollValues.pf), num(payrollValues.esi), num(payrollValues.professional_tax), num(payrollValues.income_tax),
                        num(payrollValues.loan_deduction), num(payrollValues.advance_salary), num(payrollValues.other_deduction),
                        num(payrollValues.employer_pf), num(payrollValues.employer_esi), num(payrollValues.employer_contribution),
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
