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
    return 'Rs. ' + Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ppFormatCurrency(amount) {
    return 'Rs. ' + Number(amount || 0).toLocaleString('en-IN');
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
function ppCompute(v) {
    const gross = ppNum(v.basic_salary) + ppNum(v.hra) + ppNum(v.conveyance) + ppNum(v.medical)
        + ppNum(v.special_allowance) + ppNum(v.bonus) + ppNum(v.incentive) + ppNum(v.other_allowance);
    const totalDeductions = ppNum(v.pf) + ppNum(v.esi) + ppNum(v.professional_tax) + ppNum(v.income_tax)
        + ppNum(v.loan_deduction) + ppNum(v.advance_salary) + ppNum(v.other_deduction);
    const net = gross - totalDeductions;
    const employerTotal = ppNum(v.employer_pf) + ppNum(v.employer_esi) + ppNum(v.employer_contribution);
    return { gross, totalDeductions, net, employerTotal };
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

// ---- Single-source payslip template ----

function ppKv(label, value, labelWidth) {
    return '<div style="display:flex;margin-bottom:7px;font-size:10px;line-height:1.5;">' +
        '<div style="width:' + (labelWidth || 96) + 'px;color:#666666;flex-shrink:0;">' + label + '</div>' +
        '<div style="color:#222222;font-weight:600;word-break:break-word;">' + value + '</div></div>';
}

function ppMoneyRow(label, value, last) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 13px;font-size:10px;' +
        (last ? '' : 'border-bottom:1px solid #F1EDF9;') + '">' +
        '<div style="color:#666666;">' + label + '</div>' +
        '<div style="color:#222222;font-weight:600;">' + value + '</div></div>';
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
    if (company.phone) meta.push('Phone: ' + ppEsc(company.phone));
    if (company.email) meta.push('Email: ' + ppEsc(company.email));
    if (company.website) meta.push('Web: ' + ppEsc(company.website));

    const logoHtml = company.logo
        ? '<img src="' + ppEsc(company.logo) + '" alt="logo" style="height:34px;max-width:150px;object-fit:contain;vertical-align:middle;margin-right:10px;background:#FFFFFF;border-radius:6px;padding:3px;" onerror="this.style.display=\'none\';">'
        : '<i class="fas fa-building" style="margin-right:8px;font-size:18px;"></i>';

    const earnings = [
        ['Basic Salary', ppFormatINR(p.basic_salary)],
        ['HRA', ppFormatINR(p.hra)],
        ['Conveyance', ppFormatINR(p.conveyance)],
        ['Medical Allowance', ppFormatINR(p.medical)],
        ['Special Allowance', ppFormatINR(p.special_allowance)],
        ['Bonus', ppFormatINR(p.bonus)],
        ['Incentive', ppFormatINR(p.incentive)],
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
    const employer = [
        ['Employer PF', ppFormatINR(p.employer_pf)],
        ['Employer ESI', ppFormatINR(p.employer_esi)],
        ['Employer Contribution', ppFormatINR(p.employer_contribution)]
    ];

    return '<div class="pp-sheet" style="width:794px;min-height:1123px;margin:0 auto;background:#FFFFFF;color:#222222;font-family:Poppins,\'Segoe UI\',Arial,sans-serif;position:relative;">' +

        '<!-- HEADER -->' +
        '<div style="background:linear-gradient(135deg,#6E59A5,#8B78C6);color:#FFFFFF;padding:26px 40px 20px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;">' +
                '<div style="min-width:0;">' +
                    '<div style="font-size:20px;font-weight:700;line-height:1.3;">' + logoHtml + ppEsc(name) + '</div>' +
                    '<div style="font-size:10px;color:#EDE9F8;margin-top:6px;line-height:1.6;">' +
                        headerLines.join('<br/>') +
                        (headerLines.length && meta.length ? '<br/>' : '') +
                        meta.join(' &nbsp;|&nbsp; ') +
                    '</div>' +
                '</div>' +
                '<div style="text-align:right;flex-shrink:0;">' +
                    '<div style="font-size:17px;font-weight:700;letter-spacing:3px;">PAYSLIP</div>' +
                    '<div style="font-size:12px;color:#EDE9F8;margin-top:3px;font-weight:600;">' + ppEsc(period) + '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +

        '<!-- EMPLOYEE CARD -->' +
        '<div style="margin:22px 40px 0;background:#F5F2FC;border:1px solid #E3DCF6;border-radius:8px;padding:14px 18px;">' +
            '<div style="font-size:10px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;margin-bottom:10px;">EMPLOYEE DETAILS</div>' +
            '<div style="display:flex;gap:18px;">' +
                '<div style="flex:1;min-width:0;">' +
                    ppKv('Employee ID', ppEsc(p.emp_id || '-')) +
                    ppKv('Employee Name', ppEsc(empName)) +
                    ppKv('Designation', ppEsc(p.designation_name || '-')) +
                    ppKv('Department', ppEsc(p.department_name || '-')) +
                    ppKv('Date of Joining', ppEsc(p.joining_date ? String(p.joining_date).substring(0, 10) : '-')) +
                    ppKv('PAN Number', ppEsc(p.pan_number || '-')) +
                '</div>' +
                '<div style="flex:1;min-width:0;">' +
                    ppKv('Pay Period', ppEsc(period)) +
                    ppKv('Working Days', ppNum(p.working_days)) +
                    ppKv('Present Days', ppNum(p.present_days)) +
                    ppKv('Leave Days', ppNum(p.leave_days)) +
                    ppKv('LOP Days', ppNum(p.lop_days)) +
                    ppKv('Bank Account', ppEsc(p.bank_account || '-')) +
                '</div>' +
            '</div>' +
        '</div>' +

        '<!-- EARNINGS / DEDUCTIONS -->' +
        '<div style="margin:22px 40px 0;display:flex;gap:24px;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:10px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;">EARNINGS</div>' +
                '<div style="border:1px solid #D9D9E6;border-radius:6px;margin-top:8px;overflow:hidden;">' +
                    earnings.map((r, i) => ppMoneyRow(r[0], r[1], false)).join('') +
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 13px;background:#F4F1FB;font-size:10px;font-weight:700;color:#6E59A5;">' +
                        '<div>Total Earnings</div><div>' + ppFormatINR(totals.gross) + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:10px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;">DEDUCTIONS</div>' +
                '<div style="border:1px solid #D9D9E6;border-radius:6px;margin-top:8px;overflow:hidden;">' +
                    deductions.map((r, i) => ppMoneyRow(r[0], r[1], false)).join('') +
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 13px;background:#F4F1FB;font-size:10px;font-weight:700;color:#6E59A5;">' +
                        '<div>Total Deductions</div><div>' + ppFormatINR(totals.totalDeductions) + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +

        '<!-- SUMMARY CARDS -->' +
        '<div style="margin:22px 40px 0;display:flex;gap:14px;">' +
            '<div style="flex:1;background:linear-gradient(135deg,#6E59A5,#8B78C6);color:#FFFFFF;border-radius:8px;padding:14px 18px;">' +
                '<div style="font-size:9px;letter-spacing:1px;opacity:0.92;">GROSS SALARY</div>' +
                '<div style="font-size:16px;font-weight:700;margin-top:5px;">' + ppFormatINR(totals.gross) + '</div>' +
            '</div>' +
            '<div style="flex:1;background:linear-gradient(135deg,#F57C00,#FFA726);color:#FFFFFF;border-radius:8px;padding:14px 18px;">' +
                '<div style="font-size:9px;letter-spacing:1px;opacity:0.92;">TOTAL DEDUCTIONS</div>' +
                '<div style="font-size:16px;font-weight:700;margin-top:5px;">' + ppFormatINR(totals.totalDeductions) + '</div>' +
            '</div>' +
            '<div style="flex:1;background:linear-gradient(135deg,#4CAF50,#81C784);color:#FFFFFF;border-radius:8px;padding:14px 18px;">' +
                '<div style="font-size:9px;letter-spacing:1px;opacity:0.92;">NET SALARY PAYABLE</div>' +
                '<div style="font-size:16px;font-weight:700;margin-top:5px;">' + ppFormatINR(totals.net) + '</div>' +
            '</div>' +
        '</div>' +

        '<!-- NET IN WORDS -->' +
        '<div style="margin:18px 40px 0;background:#F5F2FC;border:1px solid #E3DCF6;border-radius:8px;padding:10px 18px;">' +
            '<div style="font-size:9px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;">NET SALARY IN WORDS</div>' +
            '<div style="font-size:11px;color:#222222;margin-top:5px;font-weight:600;line-height:1.5;">' + ppEsc(ppAmountInWords(totals.net)) + '</div>' +
        '</div>' +

        '<!-- ATTENDANCE + EMPLOYER -->' +
        '<div style="margin:22px 40px 0;display:flex;gap:24px;">' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:10px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;">ATTENDANCE SUMMARY</div>' +
                '<div style="border:1px solid #D9D9E6;border-radius:6px;margin-top:8px;overflow:hidden;">' +
                    attendance.map((r, i) => ppMoneyRow(r[0], String(r[1]), i === attendance.length - 1)).join('') +
                '</div>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:10px;font-weight:700;color:#6E59A5;letter-spacing:1.2px;">EMPLOYER CONTRIBUTION</div>' +
                '<div style="border:1px solid #D9D9E6;border-radius:6px;margin-top:8px;overflow:hidden;">' +
                    employer.map((r, i) => ppMoneyRow(r[0], r[1], false)).join('') +
                    '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 13px;background:#F4F1FB;font-size:10px;font-weight:700;color:#6E59A5;">' +
                        '<div>Total Employer</div><div>' + ppFormatINR(totals.employerTotal) + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +

        '<!-- FOOTER -->' +
        '<div style="position:absolute;bottom:0;left:0;right:0;background:#6E59A5;color:#FFFFFF;text-align:center;padding:10px 16px;font-size:9px;">' +
            'This is a system generated payslip. No signature required.' +
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
        '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">' +
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
