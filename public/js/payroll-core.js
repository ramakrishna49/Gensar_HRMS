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
    const name = (company.name || p.company_name || 'Gensar IT Solutions');
    const empName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '-';
    const period = (PP_MONTHS[p.month] || '') + ' ' + (p.year || '');
    const totals = ppCompute(p);

    const headerLines = [];
    if (company.address) headerLines.push(ppEsc(company.address));
    const meta = [];
    if (company.email) meta.push('Email: ' + ppEsc(company.email));
    if (company.website) meta.push(ppEsc(company.website));
    if (company.phone) meta.push('Phone: ' + ppEsc(company.phone));

    const logoHtml = company.logo
        ? '<img src="' + ppEsc(company.logo) + '" alt="logo" style="max-height:60px;max-width:150px;object-fit:contain;vertical-align:middle;" onerror="this.style.display=\'none\';">'
        : '<i class="fas fa-building" style="font-size:26px;color:#7c6ca8;"></i>';

    const doj = p.joining_date ? String(p.joining_date).substring(0, 10) : '-';

    const earnings = [
        ['Basic Salary', ppFormatINR(p.basic_salary)],
        ['HRA', ppFormatINR(p.hra)],
        ['Conveyance', ppFormatINR(p.conveyance)],
        ['Medical Allowance', ppFormatINR(p.medical)],
        ['Special Allowance', ppFormatINR(p.special_allowance)],
        ['Other Allowance', ppFormatINR(p.other_allowance)]
    ];
    const deductions = [
        ['Employee PF', ppFormatINR(p.pf)],
        ['Employee ESI', ppFormatINR(p.esi)],
        ['Professional Tax', ppFormatINR(p.professional_tax)],
        ['Income Tax', ppFormatINR(p.income_tax)],
        ['Loan Deduction', ppFormatINR(p.loan_deduction)],
        ['Advance Salary', ppFormatINR(p.advance_salary)],
        ['Other Deduction', ppFormatINR(p.other_deduction)]
    ];
    const attendance = [
        ['Working Days', ppNum(p.working_days)],
        ['Present Days', ppNum(p.present_days)],
        ['Leave Days', ppNum(p.leave_days)],
        ['LOP Days', ppNum(p.lop_days)]
    ];
    const bonusRows = [
        ['Incentive', ppFormatINR(p.incentive)],
        ['Attendance Incentive', ppFormatINR(p.bonus)],
        ['Extra Work', ppFormatINR(p.extra_work)]
    ];

    const genDate = new Date().toLocaleDateString('en-IN');

    return '<div class="pp-sheet ppslip" style="width:794px;min-height:1123px;margin:0 auto;background:#FFFFFF;color:#222222;font-family:Arial,\'Helvetica Neue\',Helvetica,sans-serif;position:relative;padding:0 0 96px;">' +
        '<style>' +
        '.ppslip *{box-sizing:border-box;}' +
        '.ppslip table{border-collapse:collapse;}' +
        '.ppslip .pp-sec{background:#e5e0f5;color:#38286b;font-weight:700;font-size:10px;letter-spacing:1.2px;padding:6px 12px;border:1px solid #d5cee6;border-radius:3px;}' +
        '.ppslip .pp-lbl{color:#666666;font-size:10px;font-weight:400;white-space:nowrap;padding:4px 10px;}' +
        '.ppslip .pp-val{font-size:10px;font-weight:700;color:#222222;padding:4px 10px;word-break:break-word;}' +
        '</style>' +

        '<!-- HEADER -->' +
        '<div style="padding:18px 36px 0;">' +
            '<div style="display:flex;align-items:stretch;">' +
                '<div style="flex-shrink:0;width:150px;display:flex;align-items:center;">' + logoHtml + '</div>' +
                '<div style="width:1px;background:#7c6ca8;margin:2px 0;flex-shrink:0;"></div>' +
                '<div style="flex:1;min-width:0;padding-left:14px;">' +
                    '<div style="font-size:16px;font-weight:700;color:#38286b;">' + ppEsc(name) + '</div>' +
                    '<div style="font-size:10px;color:#555555;line-height:1.6;margin-top:4px;">' +
                        headerLines.join('<br/>') +
                        (headerLines.length && meta.length ? '<br/>' : '') +
                        meta.join('  |  ') +
                    '</div>' +
                '</div>' +
                '<div style="flex-shrink:0;width:112px;border:1px solid #d5cee6;border-radius:4px;overflow:hidden;background:#fbfbfd;text-align:center;">' +
                    '<div style="background:#7c6ca8;color:#FFFFFF;font-weight:700;font-size:13px;letter-spacing:2px;padding:7px 0;">PAYSLIP</div>' +
                    '<div style="color:#38286b;font-weight:700;font-size:11px;padding:9px 0;">' + ppEsc(period) + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="height:1.5px;background:#7c6ca8;margin-top:14px;"></div>' +
        '</div>' +

        '<!-- EMPLOYEE DETAILS -->' +
        '<div style="margin:14px 36px 0;">' +
            ppSecBar('EMPLOYEE DETAILS') +
            '<table style="width:100%;border:1px solid #d5cee6;background:#fbfbfd;margin-top:8px;">' +
                ppEmpRow('Employee ID', ppEsc(p.emp_id || '-'), 'Pay Period', ppEsc(period)) +
                ppEmpRow('Employee Name', ppEsc(empName), 'Working Days', ppNum(p.working_days)) +
                ppEmpRow('Designation', ppEsc(p.designation_name || '-'), 'Present Days', ppNum(p.present_days)) +
                ppEmpRow('Department', ppEsc(p.department_name || '-'), 'Leave Days', ppNum(p.leave_days)) +
                ppEmpRow('Date of Joining', ppEsc(doj), 'LOP Days', ppNum(p.lop_days)) +
                ppEmpRow('PAN Number', ppEsc(p.pan_number || '-'), 'Bank Account No', ppEsc(p.bank_account || '-')) +
                ppEmpRow('UAN Number', ppEsc(p.uan_number || '-'), 'Bank Name', ppEsc(p.bank_name || '-')) +
            '</table>' +
        '</div>' +

        '<!-- EARNINGS / DEDUCTIONS -->' +
        '<div style="margin:14px 36px 0;display:flex;gap:18px;">' +
            '<div style="flex:1;min-width:0;">' +
                ppSecBar('EARNINGS (A)') +
                '<table style="width:100%;border:1px solid #d5cee6;background:#fbfbfd;margin-top:8px;">' +
                    '<tr style="background:#e5e0f5;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">Particulars</td>' +
                        '<td class="pp-lbl" style="color:#38286b;font-weight:700;text-align:right;">AMOUNT (₹)</td></tr>' +
                    earnings.map((r) => '<tr style="border-bottom:1px solid #d5cee6;"><td class="pp-lbl">' + r[0] + '</td>' +
                        '<td class="pp-val" style="text-align:right;">' + r[1] + '</td></tr>').join('') +
                    '<tr style="background:#efeafb;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">TOTAL EARNINGS (A)</td>' +
                        '<td class="pp-val" style="color:#38286b;text-align:right;">' + ppFormatINR(totals.gross) + '</td></tr>' +
                '</table>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                ppSecBar('DEDUCTIONS (B)') +
                '<table style="width:100%;border:1px solid #d5cee6;background:#fbfbfd;margin-top:8px;">' +
                    '<tr style="background:#e5e0f5;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">Particulars</td>' +
                        '<td class="pp-lbl" style="color:#38286b;font-weight:700;text-align:right;">AMOUNT (₹)</td></tr>' +
                    deductions.map((r) => '<tr style="border-bottom:1px solid #d5cee6;"><td class="pp-lbl">' + r[0] + '</td>' +
                        '<td class="pp-val" style="text-align:right;">' + r[1] + '</td></tr>').join('') +
                    '<tr style="background:#efeafb;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">TOTAL DEDUCTIONS (B)</td>' +
                        '<td class="pp-val" style="color:#38286b;text-align:right;">' + ppFormatINR(totals.totalDeductions) + '</td></tr>' +
                '</table>' +
            '</div>' +
        '</div>' +

        '<!-- SUMMARY CARDS -->' +
        '<div style="margin:14px 36px 0;display:flex;gap:12px;">' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;letter-spacing:0.5px;">GROSS SALARY (A)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#38286b;margin-top:5px;">' + ppFormatINR(totals.gross) + '</div></div>' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;letter-spacing:0.5px;">TOTAL DEDUCTIONS (B)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#d97706;margin-top:5px;">' + ppFormatINR(totals.totalDeductions) + '</div></div>' +
            '<div style="flex:1;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:9px;text-align:center;">' +
                '<div style="font-size:10px;font-weight:700;color:#444444;letter-spacing:0.5px;">NET SALARY PAYABLE (A + C - B - D)</div>' +
                '<div style="font-size:14.5px;font-weight:700;color:#2e7d32;margin-top:5px;">' + ppFormatINR(totals.net) + '</div></div>' +
        '</div>' +

        '<!-- NET IN WORDS -->' +
        '<div style="margin:12px 36px 0;border:1px solid #d5cee6;background:#efeafb;border-radius:4px;padding:8px 14px;">' +
            '<div style="font-size:9px;font-weight:700;color:#38286b;letter-spacing:1.2px;">NET SALARY IN WORDS</div>' +
            '<div style="font-size:11px;font-weight:700;color:#222222;margin-top:4px;line-height:1.5;">' + ppEsc(ppAmountInWords(totals.net)) + '</div>' +
        '</div>' +

        '<!-- ATTENDANCE + BONUS -->' +
        '<div style="margin:14px 36px 0;display:flex;gap:18px;">' +
            '<div style="flex:1;min-width:0;">' +
                ppSecBar('ATTENDANCE SUMMARY') +
                '<table style="width:100%;border:1px solid #d5cee6;background:#fbfbfd;margin-top:8px;">' +
                    attendance.map((r, i) => ppNumRow(r[0], String(r[1]), i === attendance.length - 1)).join('') +
                '</table>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                ppSecBar('BONUS (C)') +
                '<table style="width:100%;border:1px solid #d5cee6;background:#fbfbfd;margin-top:8px;">' +
                    '<tr style="background:#e5e0f5;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">Particulars</td>' +
                        '<td class="pp-lbl" style="color:#38286b;font-weight:700;text-align:right;">AMOUNT (₹)</td></tr>' +
                    bonusRows.map((r) => '<tr style="border-bottom:1px solid #d5cee6;"><td class="pp-lbl">' + r[0] + '</td>' +
                        '<td class="pp-val" style="text-align:right;">' + r[1] + '</td></tr>').join('') +
                    '<tr style="background:#efeafb;"><td class="pp-lbl" style="color:#38286b;font-weight:700;">TOTAL (C)</td>' +
                        '<td class="pp-val" style="color:#38286b;text-align:right;">' + ppFormatINR(totals.bonus) + '</td></tr>' +
                '</table>' +
            '</div>' +
        '</div>' +

        '<!-- EMPLOYER CONTRIBUTIONS -->' +
        '<div style="margin:14px 36px 0;">' +
            ppSecBar('EMPLOYER CONTRIBUTIONS') +
            '<table style="width:100%;border:1px solid #d5cee6;margin-top:8px;">' +
                '<tr style="background:#e5e0f5;">' +
                    '<th class="pp-lbl" style="color:#38286b;font-weight:700;text-align:left;width:25%;">EMPLOYER PF</th>' +
                    '<th class="pp-lbl" style="color:#38286b;font-weight:700;text-align:left;width:25%;">EMPLOYER ESI</th>' +
                    '<th class="pp-lbl" style="color:#38286b;font-weight:700;text-align:left;width:25%;">EMPLOYER OTHER</th>' +
                    '<th class="pp-lbl" style="color:#38286b;font-weight:700;text-align:left;width:25%;">TOTAL</th>' +
                '</tr>' +
                '<tr style="background:#fbfbfd;">' +
                    '<td class="pp-val">' + ppFormatINR(p.employer_pf) + '</td>' +
                    '<td class="pp-val">' + ppFormatINR(p.employer_esi) + '</td>' +
                    '<td class="pp-val">' + ppFormatINR(p.employer_contribution) + '</td>' +
                    '<td class="pp-val" style="background:#efeafb;">' + ppFormatINR(totals.employerTotal) + '</td>' +
                '</tr>' +
            '</table>' +
        '</div>' +

        '<!-- FOOTER -->' +
        '<div style="position:absolute;left:36px;right:36px;bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;">' +
            '<div style="font-size:9px;color:#666666;line-height:1.6;">' +
                'This is a system generated payslip. No signature required.<br/>' +
                '<span style="color:#999999;">Generated on ' + genDate + '</span>' +
            '</div>' +
            '<div style="text-align:right;">' +
                '<div style="font-weight:700;color:#38286b;font-size:10px;">For ' + ppEsc(String(name).toUpperCase()) + '</div>' +
                '<div style="font-size:9px;color:#666666;margin-top:2px;">Authorised Signatory</div>' +
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
