/* ============================================================
   Payroll Core - shared helpers for admin + employee pages
   Single source payslip template (preview / download / print /
   email). Used together with html2pdf + JSZip (loaded on demand).
   ============================================================ */

const PP_MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ppNum(v) { return Number(v) || 0; }

function ppEsc(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function ppFormatINR(amount) {
    return '₹' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ppFormatCurrency(amount) {
    return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

// Indian number -> words ("Rupees .. Lakh .. Thousand .. Hundred .. Paise Only")
function ppAmountInWords(amount) {
    const value = Math.round(ppNum(amount) * 100) / 100;
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
        const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
        const lakh = Math.floor(rupees / 100000); rupees %= 100000;
        const thousand = Math.floor(rupees / 1000); rupees %= 1000;
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
    if (paise > 0) result += ' and ' + twoDigits(paise) + ' Paise';
    result += ' Only';
    return result;
}

// Mirrors the server-side computeTotals
//   A = Earnings (basic + allowances), B = Deductions, C = Bonus (incl. extra work),
//   D = Employer contributions, Net = A + C - B - D.
function ppCompute(v) {
    const gross = ppNum(v.basic_salary) + ppNum(v.hra) + ppNum(v.conveyance) + ppNum(v.medical)
        + ppNum(v.special_allowance) + ppNum(v.other_allowance);
    const totalDeductions = ppNum(v.pf) + ppNum(v.esi) + ppNum(v.professional_tax) + ppNum(v.income_tax)
        + ppNum(v.loan_deduction) + ppNum(v.advance_salary) + ppNum(v.other_deduction);
    const bonus = ppNum(v.bonus) + ppNum(v.incentive) + ppNum(v.extra_work);
    const employerTotal = ppNum(v.employer_pf) + ppNum(v.employer_esi) + ppNum(v.employer_contribution);
    const net = gross + bonus - totalDeductions - employerTotal;
    return { gross, totalDeductions, bonus, employerTotal, net };
}

// ---- Dynamic library loading (html2pdf, JSZip) ----
let ppLibsPromise = null;

function ppLoadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector('script[src="' + src + '"]')) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
    });
}

function ppEnsureLibs() {
    if (ppLibsPromise) return ppLibsPromise;
    ppLibsPromise = Promise.all([
        ppLoadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'),
        ppLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')
    ]);
    return ppLibsPromise;
}

// ---- Single-source payslip template (matches designer reference) ----

function ppSecBar(title) {
    return '<div class="pp-sec">' + title + '</div>';
}

function ppEmpRow(l1, v1, l2, v2) {
    return '<tr style="border-bottom:1px solid #d5cee6;">' +
        '<td class="pp-lbl">' + l1 + '</td><td class="pp-val">' + v1 + '</td>' +
        '<td class="pp-lbl">' + l2 + '</td><td class="pp-val">' + v2 + '</td></tr>';
}

function ppNumRow(label, value, last) {
    return '<tr' + (last ? '' : ' style="border-bottom:1px solid #d5cee6;"') + '>' +
        '<td class="pp-lbl">' + label + '</td>' +
        '<td class="pp-val" style="text-align:right;">' + value + '</td></tr>';
}

function buildPayslipHTML(p) {
    if (!p) return '';
    const company = p.company || {};
    const name = (company.name || p.company_name || 'GENSAR IT SOLUTIONS PVT. LTD.');
    const empName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '-';
    const period = (PP_MONTHS[p.month] || '') + ' ' + (p.year || '');
    const totals = ppCompute(p);
    const doj = p.joining_date ? String(p.joining_date).substring(0, 10) : '-';
    const genDate = new Date().toLocaleDateString('en-IN');
    const addr = company.address || '';
    const addrLine1 = addr ? addr.split(',').slice(0, 3).join(',') : '';
    const addrLine2 = addr ? addr.split(',').slice(3).join(',').trim() : '';
    const earnings = [
        ['Basic Salary', ppFormatINR(p.basic_salary)],
        ['HRA', ppFormatINR(p.hra)],
        ['Conveyance Allowance', ppFormatINR(p.conveyance)],
        ['Medical Allowance', ppFormatINR(p.medical)],
        ['Special Allowance', ppFormatINR(p.special_allowance)],
        ['Other Allowance', ppFormatINR(p.other_allowance)]
    ];
    const deductions = [
        ['PF Contribution', ppFormatINR(p.pf), 'PF'],
        ['ESI Contribution', ppFormatINR(p.esi), 'ESI'],
        ['Professional Tax', ppFormatINR(p.professional_tax), 'PT'],
        ['Income Tax', ppFormatINR(p.income_tax), 'IT'],
        ['Other Deductions', ppFormatINR(p.other_deduction), 'OD']
    ].filter(r => ppNum(r[1]) !== 0 || r[2] === 'OD').map(r => [r[0], r[1]]);
    const bonusRows = [
        ['Incentive', ppFormatINR(p.incentive)],
        ['Attendance Incentive', ppFormatINR(p.bonus)],
        ['Extra Work', ppFormatINR(p.extra_work)]
    ].filter(r => ppNum(r[1]) !== 0);
    const totalEarnings = totals.gross;
    const totalDeductions = totals.totalDeductions;
    const totalBonus = totals.bonus;
    const totalEmployer = totals.employerTotal;
    const logoHtml = company.logo
        ? '<img src="' + ppEsc(company.logo) + '" alt="logo" style="width:175px;max-width:175px;height:auto;object-fit:contain;flex-shrink:0;vertical-align:middle;" onerror="this.style.display=\'none\';">'
        : '<i class="fas fa-building" style="font-size:26px;color:#7c6ca8;"></i>';
    return '<div class="pp-sheet ppslip" style="width:820px;margin:0 auto;background:#FFFFFF;color:#222222;font-family:Arial,\'Helvetica Neue\',Helvetica,sans-serif;position:relative;border:1px solid #7c6ca8;padding:22px 28px;box-shadow:0 0 12px rgba(0,0,0,0.08);">' +
        '<style>' +
        '.ppslip *{box-sizing:border-box;}' +
        '.ppslip table{border-collapse:collapse;width:100%;}' +
        '.ppslip .pp-sec{background:#e5e0f5;color:#38286b;font-weight:700;font-size:11.5px;padding:6px 10px;border-left:4px solid #7c6ca8;border:1px solid #d5cee6;margin-bottom:8px;display:flex;align-items:center;gap:6px;}' +
        '.ppslip .pp-lbl{color:#333333;font-size:11.5px;font-weight:400;white-space:nowrap;padding:5.5px 10px;}' +
        '.ppslip .pp-val{font-size:11.5px;font-weight:700;color:#111111;padding:5.5px 10px;text-align:right;}' +
        '.ppslip .pp-val-left{font-size:11.5px;font-weight:700;color:#111111;padding:5.5px 10px;text-align:left;}' +
        '.ppslip .total-row td{background-color:#efeafb;font-weight:700;color:#38286b;}' +
        '.ppslip .pp-emp td{width:25%;font-size:11.5px;border:1px solid #d5cee6;padding:5.5px 10px;}' +
        '.ppslip .pp-emp td:nth-child(odd){background-color:#fbf9fc;color:#333333;}' +
        '.ppslip .pp-emp td:nth-child(even){color:#111111;font-weight:600;}' +
        '.ppslip .pp-fin th{background-color:#e5e0f5;color:#38286b;font-weight:700;font-size:11.5px;border:1px solid #d5cee6;padding:5.5px 10px;text-align:left;}' +
        '.ppslip .pp-fin td{border:1px solid #d5cee6;padding:5.5px 10px;font-size:11.5px;}' +
        '.ppslip .pp-fin .text-right{text-align:right;}' +
        '.ppslip .pp-fin{margin-bottom:12px;}' +
        '</style>' +
        '<!-- HEADER -->' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7c6ca8;padding-bottom:16px;margin-bottom:16px;">' +
            '<div style="display:flex;align-items:center;gap:15px;">' +
                '<div style="flex-shrink:0;">' + logoHtml + '</div>' +
                '<div style="width:1px;height:95px;background:#7c6ca8;margin:0 5px;flex-shrink:0;align-self:center;"></div>' +
                '<div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;">' +
                    '<div style="font-size:19px;font-weight:900;color:#111111;letter-spacing:0.2px;margin-bottom:5px;">' + ppEsc(name) + '</div>' +
                    (addrLine1 ? '<div style="display:flex;align-items:center;font-size:10.5px;color:#222222;line-height:1.2;margin-bottom:3px;">' + ppEsc(addrLine1) + '</div>' : '') +
                    (addrLine2 ? '<div style="display:flex;align-items:center;font-size:10.5px;color:#222222;line-height:1.2;margin-bottom:3px;">' + ppEsc(addrLine2) + '</div>' : '') +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222222;line-height:1.2;margin-bottom:3px;">Email: ' + ppEsc(company.email || 'hr@gensaritsolutions.com') + '</div>' +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222222;line-height:1.2;margin-bottom:3px;">' + ppEsc(company.website || 'www.gensarhrms.in') + '</div>' +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222222;line-height:1.2;margin-bottom:3px;">Phone: ' + ppEsc(company.phone || '+91 40 4855 6600') + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="width:150px;border:1px solid #7c6ca8;border-radius:6px;overflow:hidden;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
                '<div style="background:#7c6ca8;color:#FFFFFF;font-weight:700;font-size:15px;letter-spacing:1px;padding:7px 0;">PAYSLIP</div>' +
                '<div style="background:#FFFFFF;color:#111111;font-weight:700;font-size:13.5px;padding:8px 0;">' + ppEsc(period) + '</div>' +
            '</div>' +
        '</div>' +
        '<!-- EMPLOYEE DETAILS -->' +
        '<div class="pp-sec">EMPLOYEE DETAILS</div>' +
        '<table class="pp-emp" style="margin-bottom:12px;">' +
            ppEmpRow('Employee ID', ppEsc(p.emp_id || '-'), 'Pay Period', ppEsc(period)) +
            ppEmpRow('Employee Name', ppEsc(empName), 'Working Days', ppNum(p.working_days)) +
            ppEmpRow('Designation', ppEsc(p.designation_name || '-'), 'Present Days', ppNum(p.present_days)) +
            ppEmpRow('Department', ppEsc(p.department_name || '-'), 'Leave Days', ppNum(p.leave_days)) +
            ppEmpRow('Date of Joining', ppEsc(doj), 'LOP Days', ppNum(p.lop_days)) +
            ppEmpRow('PAN Number', ppEsc(p.pan_number || '-'), 'Bank Account No', ppEsc(p.bank_account || '-')) +
            ppEmpRow('UAN Number', ppEsc(p.uan_number || '-'), 'Bank Name', ppEsc(p.bank_name || '-')) +
        '</table>' +
        '<!-- EARNINGS / DEDUCTIONS -->' +
        '<div style="display:flex;gap:12px;margin-bottom:2px;">' +
            '<div style="flex:1;min-width:0;">' +
                '<table class="pp-fin">' +
                    '<thead><tr><th>EARNINGS</th><th class="text-right">AMOUNT (₹)</th></tr></thead>' +
                    '<tbody>' +
                        earnings.map((r) => '<tr><td class="pp-lbl">' + r[0] + '</td><td class="text-right">' + r[1] + '</td></tr>').join('') +
                        '<tr class="total-row"><td>TOTAL EARNINGS (A)</td><td class="text-right">' + ppFormatINR(totalEarnings) + '</td></tr>' +
                    '</tbody>' +
                '</table>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<table class="pp-fin">' +
                    '<thead><tr><th>DEDUCTIONS</th><th class="text-right">AMOUNT (₹)</th></tr></thead>' +
                    '<tbody>' +
                        deductions.map((r) => '<tr><td class="pp-lbl">' + r[0] + '</td><td class="text-right">' + r[1] + '</td></tr>').join('') +
                        '<tr class="total-row"><td>TOTAL DEDUCTIONS (B)</td><td class="text-right">' + ppFormatINR(totalDeductions) + '</td></tr>' +
                    '</tbody>' +
                '</table>' +
            '</div>' +
        '</div>' +
        '<!-- SUMMARY CARDS -->' +
        '<div style="display:flex;gap:10px;margin-bottom:10px;">' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;margin-bottom:5px;">GROSS SALARY (A)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#38286b;">' + ppFormatINR(totalEarnings) + '</div></div>' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;margin-bottom:5px;">TOTAL DEDUCTIONS (B)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#d97706;">' + ppFormatINR(totalDeductions) + '</div></div>' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;margin-bottom:5px;">NET SALARY PAYABLE (A - B + C)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#2e7d32;">' + ppFormatINR(totals.net) + '</div></div>' +
        '</div>' +
        '<!-- Net Salary in Words -->' +
        '<div style="background:#fbfbfd;border:1px solid #d5cee6;padding:7px 12px;font-size:11.5px;margin-bottom:12px;display:flex;gap:12px;align-items:center;">' +
            '<span style="font-weight:700;color:#38286b;white-space:nowrap;">NET SALARY IN WORDS:</span>' +
            '<span style="font-style:italic;color:#222222;">' + ppEsc(ppAmountInWords(totals.net)) + '</span>' +
        '</div>' +
        '<!-- ATTENDANCE + BONUS -->' +
        '<div style="display:flex;gap:12px;margin-bottom:2px;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div class="pp-sec" style="margin-bottom:0;border-bottom:none;">ATTENDANCE SUMMARY</div>' +
                '<table class="pp-fin" style="border-top:none;">' +
                    '<thead><tr><th style="text-align:center;">Working Days</th><th style="text-align:center;">Present Days</th><th style="text-align:center;">Leave Days</th><th style="text-align:center;">LOP Days</th></tr></thead>' +
                    '<tbody><tr>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.working_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.present_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.leave_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.lop_days) + '</td>' +
                    '</tr></tbody>' +
                '</table>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<table class="pp-fin">' +
                    '<thead><tr><th>BONUS (C)</th><th class="text-right">AMOUNT (₹)</th></tr></thead>' +
                    '<tbody>' +
                        bonusRows.map((r) => '<tr><td class="pp-lbl">' + r[0] + '</td><td class="text-right">' + r[1] + '</td></tr>').join('') +
                        '<tr class="total-row"><td>TOTAL BONUS (C)</td><td class="text-right">' + ppFormatINR(totalBonus) + '</td></tr>' +
                    '</tbody>' +
                '</table>' +
            '</div>' +
        '</div>' +
        '<!-- EMPLOYER CONTRIBUTIONS -->' +
        '<div style="margin-bottom:2px;">' +
            '<table class="pp-fin">' +
                '<thead><tr><th>EMPLOYER CONTRIBUTIONS</th><th class="text-right">AMOUNT (₹)</th></tr></thead>' +
                '<tbody>' +
                    '<tr><td>Employer PF Contribution</td><td class="text-right">' + ppFormatINR(p.employer_pf) + '</td></tr>' +
                    '<tr><td>Employer ESI Contribution</td><td class="text-right">' + ppFormatINR(p.employer_esi) + '</td></tr>' +
                    '<tr><td>Employer Other Contribution</td><td class="text-right">' + ppFormatINR(p.employer_contribution) + '</td></tr>' +
                    '<tr class="total-row"><td>TOTAL EMPLOYER CONTRIBUTION</td><td class="text-right">' + ppFormatINR(totalEmployer) + '</td></tr>' +
                '</tbody>' +
            '</table>' +
        '</div>' +
        '<!-- FOOTER -->' +
        '<div style="display:flex;justify-content:space-between;margin-top:14px;padding-top:10px;border-top:1px solid #d5cee6;font-size:10.5px;align-items:flex-end;">' +
            '<div>' +
                '<strong>Note:</strong>' +
                '<ul style="list-style-type:disc;padding-left:15px;color:#555555;line-height:1.4;margin-top:4px;">' +
                    '<li>This is a computer generated payslip.</li>' +
                    '<li>No signature is required.</li>' +
                    '<li>Please contact HR for any discrepancies.</li>' +
                '</ul>' +
            '</div>' +
            '<div style="text-align:right;">' +
                '<div style="font-weight:700;color:#38286b;margin-bottom:18px;">For ' + ppEsc(String(name).toUpperCase()) + '</div>' +
                '<div style="color:#555555;">This is a system generated document and does not require signature.</div>' +
            '</div>' +
        '</div>' +
    '</div>';
}

// Render preview into a container
function renderPayslipPreview(p, container) {
    if (!container) return;
    container.innerHTML = buildPayslipHTML(p);
}

// html2pdf: generate PDF blob from the template
async function payslipHtmlToPdfBlob(p) {
    await ppEnsureLibs();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
    holder.innerHTML = buildPayslipHTML(p);
    document.body.appendChild(holder);
    try {
        const el = holder.querySelector('.pp-sheet');
        if (!el) throw new Error('Payslip template not rendered');
        const blob = await html2pdf().set({
            margin: 0,
            filename: 'payslip.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(el).outputPdf('blob');
        return blob;
    } finally {
        holder.remove();
    }
}

function ppBlobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}

async function payslipToDataUrl(p) {
    const blob = await payslipHtmlToPdfBlob(p);
    return await ppBlobToBase64(blob);
}

// Download the payslip PDF locally (html2pdf WYSIWYG)
async function downloadPayslip(p, filename) {
    await ppEnsureLibs();
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;';
    holder.innerHTML = buildPayslipHTML(p);
    document.body.appendChild(holder);
    try {
        const el = holder.querySelector('.pp-sheet');
        const name = filename || ('payslip_' + (p.emp_id || p.employee_id || '') + '_' + (p.month || '') + '_' + (p.year || '') + '.pdf');
        await html2pdf().set({
            margin: 0,
            filename: name,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(el).save();
    } finally {
        holder.remove();
    }
}

// Open print window with only the payslip
function printPayslip(p) {
    const w = window.open('', '_blank');
    if (!w) { showToast('Popup blocked. Allow popups to print.', 'error'); return; }
    w.document.write(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payslip</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">' +
        '<style>html,body{margin:0;padding:0;background:#FFFFFF;}@page{size:A4;margin:0;}' +
        '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}' +
        '</style></head><body>' +
        buildPayslipHTML(p) +
        '<script>window.onload=function(){window.focus();setTimeout(function(){window.print();},300);};</script>' +
        '</body></html>'
    );
    w.document.close();
}

// Bulk ZIP download of payslip PDFs
async function zipPayslips(payslips, zipName) {
    await ppEnsureLibs();
    const zip = new JSZip();
    for (const p of payslips) {
        const blob = await payslipHtmlToPdfBlob(p);
        zip.file('Payslip_' + (p.emp_id || p.employee_id || 'emp') + '_' + (p.month || '') + '_' + (p.year || '') + '.pdf', blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName || ('payslips_' + Date.now() + '.zip');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

if (typeof window !== 'undefined') {
    window.ppNum = ppNum;
    window.ppEsc = ppEsc;
    window.ppFormatINR = ppFormatINR;
    window.ppFormatCurrency = ppFormatCurrency;
    window.ppAmountInWords = ppAmountInWords;
    window.ppCompute = ppCompute;
    window.buildPayslipHTML = buildPayslipHTML;
    window.renderPayslipPreview = renderPayslipPreview;
    window.payslipHtmlToPdfBlob = payslipHtmlToPdfBlob;
    window.payslipToDataUrl = payslipToDataUrl;
    window.downloadPayslip = downloadPayslip;
    window.printPayslip = printPayslip;
    window.zipPayslips = zipPayslips;
    window.PP_MONTHS = PP_MONTHS;
}
