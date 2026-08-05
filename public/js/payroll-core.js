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

// Plain Indian-formatted number (no currency symbol) for payslip tables, matching the reference.
function ppNumFmt(amount) {
    return Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
//   D = Employer contributions, Net = Gross - LOP deduction + C - B - D.
function ppCompute(v) {
    const gross = ppNum(v.basic_salary) + ppNum(v.hra) + ppNum(v.conveyance)
        + ppNum(v.special_allowance) + ppNum(v.other_allowance);
    const totalDeductions = ppNum(v.pf) + ppNum(v.esi) + ppNum(v.professional_tax) + ppNum(v.income_tax)
        + ppNum(v.other_deduction);
    const bonus = ppNum(v.bonus) + ppNum(v.incentive) + ppNum(v.extra_work);
    const employerTotal = ppNum(v.employer_pf) + ppNum(v.employer_esi) + ppNum(v.employer_contribution);
    const workingDays = ppNum(v.working_days);
    const presentDays = ppNum(v.present_days);
    const leaveDays = ppNum(v.leave_days);
    const lopDays = ppNum(v.lop_days);
    const paidDays = presentDays + leaveDays;
    const attendanceValid = Math.abs(workingDays - (presentDays + leaveDays + lopDays)) < 0.001;
    const perDaySalary = workingDays > 0 ? gross / workingDays : 0;
    const lopDeduction = perDaySalary * lopDays;
    const net = gross - lopDeduction + bonus - totalDeductions - employerTotal;
    return { gross, totalDeductions, bonus, employerTotal, workingDays, presentDays, leaveDays, lopDays, paidDays, perDaySalary, lopDeduction, attendanceValid, net };
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
    return '<tr>' +
        '<td>' + l1 + '</td><td>' + v1 + '</td>' +
        '<td>' + l2 + '</td><td>' + v2 + '</td></tr>';
}

function ppNumRow(label, value, last) {
    return '<tr>' +
        '<td>' + label + '</td>' +
        '<td class="text-right">' + value + '</td></tr>';
}

function buildPayslipHTML(p) {
    if (!p) return '';
    const company = p.company || {};
    const empName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '-';
    const period = (PP_MONTHS[p.month] || '') + ' ' + (p.year || '');
    const totals = ppCompute(p);
    const doj = p.joining_date ? String(p.joining_date).substring(0, 10) : '-';
    const earnings = [
        ['Basic Salary', ppNumFmt(p.basic_salary)],
        ['HRA', ppNumFmt(p.hra)],
        ['Conveyance Allowance', ppNumFmt(p.conveyance)],
        ['Special Allowance', ppNumFmt(p.special_allowance)],
        ['Other Allowance', ppNumFmt(p.other_allowance)]
    ];
    const deductions = [
        ['PF Contribution', ppNumFmt(p.pf)],
        ['ESI Contribution', ppNumFmt(p.esi)],
        ['Professional Tax', ppNumFmt(p.professional_tax)],
        ['Income Tax', ppNumFmt(p.income_tax)],
        ['Other Deductions', ppNumFmt(p.other_deduction)]
    ];
    const bonusRows = [
        ['Incentive', ppNumFmt(p.incentive)],
        ['Attendance Incentive', ppNumFmt(p.bonus)],
        ['Extra Work', ppNumFmt(p.extra_work)]
    ];
    const finTable = (title, rows, totalLabel, totalValue, extraStyle) =>
        '<table class="pp-fin"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' +
            '<thead><tr><th>' + title + '</th><th class="text-right">AMOUNT (\u20B9)</th></tr></thead>' +
            '<tbody>' +
                rows.map((r) => '<tr><td>' + r[0] + '</td><td class="text-right">' + r[1] + '</td></tr>').join('') +
                '<tr class="total-row"><td>' + totalLabel + '</td><td class="text-right">' + ppNumFmt(totalValue) + '</td></tr>' +
            '</tbody></table>';
    const logoHtml = (company.logo || '/assets/images/gensar_logo.png')
        ? '<img src="' + ppEsc(company.logo || '/assets/images/gensar_logo.png') + '" alt="Gensar Logo" style="width:175px;height:auto;object-fit:contain;flex-shrink:0;" onerror="this.style.display=\'none\';">'
        : '<i class="fas fa-building" style="font-size:26px;color:#7c6ca8;"></i>';
    return '<div class="pp-sheet ppslip" style="width:820px;box-sizing:border-box;margin:0 auto;background:#ffffff;color:#222;font-family:Arial,Helvetica,sans-serif;border:1px solid #7c6ca8;padding:22px 28px;box-shadow:0 0 12px rgba(0,0,0,0.08);">' +
        '<style>' +
        '.ppslip{line-height:normal;}' +
        '.ppslip *{box-sizing:border-box;}' +
        '.ppslip table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:12px;}' +
        '.ppslip th,.ppslip td{border:1px solid #d5cee6;padding:5.5px 10px;text-align:left;font-size:11.5px;text-transform:none;letter-spacing:normal;white-space:normal;}' +
        '.ppslip th{font-weight:700;}' +
        '.ppslip tbody tr:last-child td{border-bottom:1px solid #d5cee6;}' +
        '.ppslip tbody tr:hover{background:transparent;}' +
        '.ppslip tr{transition:none;}' +
        '.ppslip .text-right{text-align:right;}' +
        '.ppslip .pp-sec{background:#e5e0f5;color:#38286b;padding:6px 10px;font-size:11.5px;font-weight:700;display:flex;align-items:center;gap:6px;border-top:1px solid #d5cee6;border-right:1px solid #d5cee6;border-bottom:1px solid #d5cee6;border-left:4px solid #7c6ca8;margin-bottom:8px;}' +
        '.ppslip .pp-emp td{width:25%;}' +
        '.ppslip .pp-emp td:nth-child(odd){background:#fbf9fc;color:#333;}' +
        '.ppslip .pp-emp td:nth-child(even){color:#111;font-weight:600;}' +
        '.ppslip .pp-fin th{background:#e5e0f5;color:#38286b;font-weight:700;font-size:11.5px;border:1px solid #d5cee6;}' +
        '.ppslip .pp-fin td{border:1px solid #d5cee6;}' +
        '.ppslip .pp-att-values td{padding-top:2px;padding-bottom:2px;height:28px;}' +
        '.ppslip .pp-attendance{display:flex;flex-direction:column;}' +
        '.ppslip .pp-attendance thead{display:table;table-layout:fixed;width:100%;flex:0 0 30px;}' +
        '.ppslip .pp-attendance thead th{line-height:1.0;}' +
        '.ppslip .pp-attendance tbody{display:table;table-layout:fixed;width:100%;flex:0 0 28px;}' +
        '.ppslip .total-row td{background:#efeafb;font-weight:700;color:#38286b;}' +
        '</style>' +
        '<!-- HEADER -->' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7c6ca8;padding-bottom:16px;margin-bottom:16px;">' +
            '<div style="display:flex;align-items:center;gap:15px;">' +
                '<div style="flex-shrink:0;">' + logoHtml + '</div>' +
                '<div style="width:1px;height:95px;background:#7c6ca8;margin:0 5px;flex-shrink:0;align-self:center;"></div>' +
                '<div style="display:flex;flex-direction:column;justify-content:center;">' +
                    '<div style="font-size:19px;font-weight:900;color:#111;letter-spacing:0.2px;margin-bottom:5px;">GENSAR IT SOLUTIONS PVT. LTD.</div>' +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222;line-height:1.2;margin-bottom:3px;">Manjeera Trinity Corporate, 4th Floor, #402, KPHB, Kukatpally,<br>Hyderabad, 500072, Telangana, India</div>' +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222;line-height:1.2;margin-bottom:3px;">E-Mail: hr@gensarit.com</div>' +
                    '<div style="display:flex;align-items:center;font-size:10.5px;color:#222;line-height:1.2;margin-bottom:3px;">Ph No: +91 9121912138</div>' +
                '</div>' +
            '</div>' +
            '<div style="width:150px;border:1px solid #7c6ca8;border-radius:6px;overflow:hidden;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
                '<div style="background:#7c6ca8;color:#FFFFFF;font-weight:700;font-size:15px;letter-spacing:1px;padding:7px 0;">PAYSLIP</div>' +
                '<div style="background:#FFFFFF;color:#111111;font-weight:700;font-size:13.5px;padding:8px 0;">' + ppEsc(period) + '</div>' +
            '</div>' +
        '</div>' +
        '<!-- EMPLOYEE DETAILS -->' +
        '<div class="pp-sec">EMPLOYEE DETAILS</div>' +
        '<table class="pp-emp">' +
            ppEmpRow('Employee ID', ppEsc(p.emp_id || '-'), 'Pay Period', ppEsc(period)) +
            ppEmpRow('Employee Name', ppEsc(empName), 'Working Days', ppNum(p.working_days)) +
            ppEmpRow('Designation', ppEsc(p.designation_name || '-'), 'Present Days', ppNum(p.present_days)) +
            ppEmpRow('Department', ppEsc(p.department_name || '-'), 'Leave Days', ppNum(p.leave_days)) +
            ppEmpRow('Date of Joining', ppEsc(doj), 'LOP Days', ppNum(p.lop_days)) +
            ppEmpRow('PAN Number', ppEsc(p.pan_number || '-'), 'Bank Account No.', ppEsc(p.bank_account || '-')) +
            ppEmpRow('UAN Number', ppEsc(p.uan_number || '-'), 'Bank Name', ppEsc(p.bank_name || '-')) +
        '</table>' +
        '<!-- EARNINGS / DEDUCTIONS -->' +
        '<div style="display:flex;gap:12px;margin-bottom:2px;">' +
            '<div style="flex:1;min-width:0;">' + finTable('EARNINGS', earnings, 'TOTAL EARNINGS (A)', totals.gross) + '</div>' +
            '<div style="flex:1;min-width:0;">' + finTable('DEDUCTIONS', deductions, 'TOTAL DEDUCTIONS (B)', totals.totalDeductions) + '</div>' +
        '</div>' +
        '<!-- SUMMARY CARDS -->' +
        '<div style="display:flex;justify-content:center;gap:10px;margin-bottom:10px;">' +
            '<div style="flex:1;min-width:0;height:65px;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:8px 5px;text-align:center;display:flex;flex-direction:column;justify-content:center;">' +
                '<div style="font-size:13.5px;font-weight:700;color:#444;margin-bottom:5px;white-space:nowrap;">GROSS SALARY (A)</div>' +
                '<div style="font-size:19px;font-weight:700;color:#38286b;">\u20B9 ' + ppNumFmt(totals.gross) + '</div></div>' +
            '<div style="flex:1;min-width:0;height:65px;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:8px 5px;text-align:center;display:flex;flex-direction:column;justify-content:center;">' +
                '<div style="font-size:13.5px;font-weight:700;color:#444;margin-bottom:5px;white-space:nowrap;">TOTAL DEDUCTIONS (B)</div>' +
                '<div style="font-size:19px;font-weight:700;color:#d97706;">\u20B9 ' + ppNumFmt(totals.totalDeductions) + '</div></div>' +
            '<div style="flex:1;min-width:0;height:65px;background:#fbfbfd;border:1px solid #d5cee6;border-radius:5px;padding:8px 5px;text-align:center;display:flex;flex-direction:column;justify-content:center;">' +
                '<div style="font-size:13.5px;font-weight:700;color:#444;margin-bottom:5px;white-space:nowrap;">NET SALARY PAYABLE (A + C - B - D)</div>' +
                '<div style="font-size:19px;font-weight:700;color:#2e7d32;">\u20B9 ' + ppNumFmt(totals.net) + '</div></div>' +
        '</div>' +
        '<!-- Net Salary in Words -->' +
        '<div style="background:#fbfbfd;border:1px solid #d5cee6;padding:7px 12px;font-size:11.5px;margin-bottom:12px;display:flex;gap:12px;align-items:center;">' +
            '<span style="font-weight:700;color:#38286b;white-space:nowrap;">NET SALARY IN WORDS:</span>' +
            '<span style="font-style:italic;color:#222222;">' + ppEsc(ppAmountInWords(totals.net)) + '</span>' +
        '</div>' +
        '<!-- ATTENDANCE + BONUS -->' +
        '<div style="display:flex;gap:20px;margin-bottom:2px;align-items:stretch;">' +
            '<div style="flex:0 0 46%;min-width:0;overflow:hidden;display:flex;flex-direction:column;">' +
                '<div class="pp-sec" style="margin-bottom:0;border-bottom:none;">ATTENDANCE SUMMARY</div>' +
                '<table class="pp-fin pp-attendance" style="border-top:none;flex:1;max-width:100%;">' +
                    '<thead><tr><th style="text-align:center;">Working Days</th><th style="text-align:center;">Present Days</th><th style="text-align:center;">Leave Days</th><th style="text-align:center;">LOP Days</th></tr></thead>' +
                    '<tbody><tr class="pp-att-values">' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.working_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.present_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.leave_days) + '</td>' +
                        '<td style="text-align:center;font-weight:700;">' + ppNum(p.lop_days) + '</td>' +
                    '</tr></tbody>' +
                '</table>' +
            '</div>' +
            '<div style="flex:1;min-width:0;display:flex;flex-direction:column;">' + finTable('BONUS (C)', bonusRows, 'TOTAL BONUS (C)', totals.bonus, 'flex:1;max-width:100%;') + '</div>' +
        '</div>' +
        '<!-- EMPLOYER CONTRIBUTIONS -->' +
        '<div style="margin-bottom:2px;">' + finTable('EMPLOYER CONTRIBUTIONS', [
            ['Employer PF Contribution', ppNumFmt(p.employer_pf)],
            ['Employer ESI Contribution', ppNumFmt(p.employer_esi)],
            ['Employer Other Contribution', ppNumFmt(p.employer_contribution)]
        ], 'TOTAL EMPLOYER CONTRIBUTION (D)', totals.employerTotal) + '</div>' +
        '<!-- FOOTER -->' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:6px;padding-bottom:0;border-top:1px solid #d5cee6;font-size:10.5px;align-items:flex-end;">' +
            '<div>' +
                '<strong>Note:</strong>' +
                '<ul style="list-style-type:disc;padding-left:15px;color:#555;line-height:1.4;margin:0;">' +
                    '<li>This is a computer generated payslip.</li>' +
                    '<li>No signature is required.</li>' +
                    '<li>Please contact HR for any discrepancies.</li>' +
                '</ul>' +
            '</div>' +
            '<div style="text-align:right;">' +
                '<div style="font-weight:700;color:#38286b;margin-bottom:8px;">For GENSAR IT SOLUTIONS PVT. LTD.</div>' +
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
