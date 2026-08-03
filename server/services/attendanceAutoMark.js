const { query } = require('../config/database');
const { istDateString, istTimeString } = require('../utils/date');

const OFFICE_END_TIME = '18:30:00';
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function isWeekend(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    return day === 0 || day === 6;
}

function isPastCutoff(now) {
    const currentTime = istTimeString(now);
    return currentTime > OFFICE_END_TIME;
}

// Mark absent for a single date. Skips holidays, approved leave, approved WFH,
// and any employee who already has an attendance row for that date.
async function markAbsentForDate(dateStr) {
    const result = await query(
        `INSERT INTO attendance (employee_id, date, status, remarks)
        SELECT e.id, $1, 'absent', 'Auto-marked absent (no check-in)'
        FROM employees e
        WHERE e.status = 'active'
          AND e.role != 'admin'
          AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.date = $2)
          AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = $3 AND h.is_active = 1)
          AND NOT EXISTS (
              SELECT 1 FROM leave_applications la
              WHERE la.employee_id = e.id AND la.status = 'approved'
                AND la.start_date <= $4 AND la.end_date >= $5
          )
          AND NOT EXISTS (
              SELECT 1 FROM wfh_requests wr
              WHERE wr.employee_id = e.id AND wr.status = 'approved'
                AND wr.start_date <= $6 AND wr.end_date >= $7
          )`,
        [dateStr, dateStr, dateStr, dateStr, dateStr, dateStr, dateStr]
    );
    return result.changes || 0;
}

// Process weekdays from (inclusive) startDate through (inclusive) endDate.
// For today, only mark absent once the office end time has passed.
async function runAutoMark() {
    const now = new Date();
    const todayStr = istDateString();
    const today = new Date(todayStr + 'T00:00:00');

    let total = 0;
    let processedDates = [];

    // Look back up to 30 days to catch up any missed weekdays.
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = istDateString(d);

        if (dateStr > todayStr) continue;
        if (isWeekend(dateStr)) continue;

        // Current day only counts once office hours are over.
        if (dateStr === todayStr && !isPastCutoff(now)) continue;

        const marked = await markAbsentForDate(dateStr);
        total += marked;
        processedDates.push(dateStr + (marked ? ' (+' + marked + ')' : ''));
    }

    if (total > 0 || processedDates.length > 0) {
        console.log(`[Attendance] Auto-absent check: ${processedDates.join(', ')} (total marked: ${total})`);
    }
    return total;
}

// Legacy entry point kept for compatibility. Vercel Cron triggers runAutoMark directly.
function startAutoMarkScheduler() {
    runAutoMark().catch(e => console.error('[Attendance] Auto-absent startup run error:', e.message));
    setInterval(() => {
        runAutoMark().catch(e => console.error('[Attendance] Auto-absent run error:', e.message));
    }, CHECK_INTERVAL_MS);
}

module.exports = { markAbsentForDate, runAutoMark, startAutoMarkScheduler, isWeekend, isPastCutoff };
