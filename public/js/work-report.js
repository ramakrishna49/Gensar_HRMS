/* ============================================
   WORK REPORT RENDERING HELPERS
   Consumes the admin weekly report API shape:
   {
     dateRange: { start, end, dates: [{date, label, dayName, isSunday}] },
     holidays: { 'YYYY-MM-DD': name },
     projects: [{
        id, name, customer_name, weekly_target_per_employee, daily_target,
        working_days, assigned_count, weekly_target_total, daily_target_total,
        employees: [{ id, name, emp_code, weekly_target, daily_target,
                      counts: { 'YYYY-MM-DD': count } }],
        project_total: { 'YYYY-MM-DD': count }
     }],
     grand_total: { 'YYYY-MM-DD': count }
   }
   ============================================ */

function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function formatWeekLabel(start) {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const opts = { day: '2-digit', month: 'short' };
    return start.toLocaleDateString('en-IN', opts) + ' — ' + end.toLocaleDateString('en-IN', opts);
}

function formatTime(str) {
    if (!str) return '--';
    return new Date(str).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Build the weekly report table HTML from the admin weekly API response.
 * @param {Object} data - the /api/work-reports/weekly response body
 * @returns {Object} { theadHtml, tbodyHtml, grandTotal }
 */
function buildWeeklyReportTable(data) {
    const dates = data.dateRange ? data.dateRange.dates : (data.dates || []);
    const projects = data.projects || [];
    const holidays = data.holidays || {};
    const grandTotalMap = data.grand_total || {};

    let theadHtml = '<tr><th class="wr-col-project">Project</th><th class="wr-col-name">Employee</th><th class="wr-target">Weekly Tgt</th>';
    dates.forEach(dt => {
        const cls = dt.isSunday ? ' wr-sunday' : (holidays[dt.date] ? ' wr-holiday' : '');
        const label = (dt.dayName || '') + '<br>' + dt.label;
        theadHtml += '<th class="wr-date-col' + cls + '">' + label + '</th>';
    });
    theadHtml += '<th class="wr-total-col">Total</th></tr>';

    let tbodyHtml = '';
    let grandTotal = 0;
    const grandTotalCalcs = {};
    dates.forEach(dt => { grandTotalCalcs[dt.date] = 0; });

    projects.forEach((proj, pi) => {
        tbodyHtml += '<tr class="wr-project-header"><td colspan="' + (dates.length + 4) + '">' + escapeHtml(proj.name) +
            ' <span style="font-weight:400;font-size:.75rem;color:var(--text-secondary);">(' + (proj.assigned_count || 0) + ' employees)</span></td></tr>';

        let projTotal = 0;
        (proj.employees || []).forEach(emp => {
            tbodyHtml += '<tr class="wr-employee-row">';
            tbodyHtml += '<td class="wr-col-project" style="color:var(--text-secondary);font-size:.72rem;">' + escapeHtml(proj.name) + '</td>';
            tbodyHtml += '<td class="wr-col-name">' + escapeHtml(emp.name) + ' <span style="font-size:.68rem;color:var(--text-secondary);">' + escapeHtml(emp.emp_code || '') + '</span></td>';
            tbodyHtml += '<td class="wr-target">' + Number(emp.weekly_target).toLocaleString('en-IN') + '</td>';

            let empTotal = 0;
            dates.forEach(dt => {
                const val = emp.counts ? (emp.counts[dt.date] || 0) : 0;
                empTotal += val;
                const cls = dt.isSunday ? ' wr-sunday' : (holidays[dt.date] ? ' wr-holiday' : '');
                const valCls = val === 0 ? ' wr-count-zero' : ' wr-count-present';
                tbodyHtml += '<td class="wr-date-col' + cls + '"><span class="wr-count' + valCls + '">' + (val > 0 ? Number(val).toLocaleString('en-IN') : '--') + '</span></td>';
            });

            tbodyHtml += '<td class="wr-total-col wr-count-present">' + Number(empTotal).toLocaleString('en-IN') + '</td>';
            tbodyHtml += '</tr>';
            projTotal += empTotal;
        });

        // Project total row
        tbodyHtml += '<tr class="wr-project-total"><td colspan="3">Total</td>';
        dates.forEach(dt => {
            const dtTotal = proj.project_total ? (proj.project_total[dt.date] || 0) : 0;
            grandTotalCalcs[dt.date] += dtTotal;
            tbodyHtml += '<td class="wr-date-col" style="text-align:right;font-weight:600;">' + (dtTotal > 0 ? Number(dtTotal).toLocaleString('en-IN') : '--') + '</td>';
        });
        tbodyHtml += '<td class="wr-total-col">' + Number(projTotal).toLocaleString('en-IN') + '</td></tr>';
        grandTotal += projTotal;
    });

    // Grand total row
    tbodyHtml += '<tr class="wr-grand-total"><td colspan="3" style="font-weight:700;">GRAND TOTAL</td>';
    dates.forEach(dt => {
        const dtGrand = grandTotalCalcs[dt.date] || (grandTotalMap[dt.date] || 0);
        tbodyHtml += '<td class="wr-date-col" style="text-align:right;font-weight:700;">' + (dtGrand > 0 ? Number(dtGrand).toLocaleString('en-IN') : '--') + '</td>';
    });
    tbodyHtml += '<td class="wr-total-col">' + Number(grandTotal).toLocaleString('en-IN') + '</td></tr>';

    return { theadHtml, tbodyHtml, grandTotal };
}
