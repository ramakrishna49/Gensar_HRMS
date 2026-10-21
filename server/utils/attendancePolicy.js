const { query } = require('../config/database');

// Late-login policy shared by the self check-in flow and the admin
// Mark Late flow, so both always classify a time the same way.
//
//   0 .. start+grace      -> present
//   start+grace .. 12:00  -> late (1st-3rd late of the month)
//   4th late onwards      -> half-day with a "Nth late - auto half day"
//                            remark (the attendance matrix shows it as HD4)
//   after 12:00           -> half-day (not counted as a late)
const DEFAULT_START = '09:30';
const DEFAULT_GRACE = 15;
const HALF_DAY_CUTOFF_MINS = 12 * 60;

// Matches the HD4 marker written by resolveCheckIn, optionally followed by
// an admin remark: "4th late - auto half day; called HR".
const HD4_MARKER_RE = /^\s*\d+(?:st|nd|rd|th)\s+late\s*-\s*auto half day/i;
// Postgres regex used to count HD4 rows in the month.
const HD4_MARKER_SQL = 'late\\s*-\\s*auto half day';
const AFTER_NOON_RE = /^\s*checked in after 12:00\s*-\s*half day\s*;?\s*/i;

function timeToMinutes(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

function normalizeTime(value) {
    const m = String(value || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return `${String(m[1]).padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

function minutesToLabel(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function getPolicy() {
    let settings = { rows: [] };
    try {
        settings = await query(
            `SELECT setting_key, setting_value FROM company_settings
             WHERE setting_key IN ('office_start_time', 'late_grace_period')`
        );
    } catch (e) {
        settings = { rows: [] };
    }
    const map = {};
    settings.rows.forEach(s => { map[s.setting_key] = s.setting_value; });

    const officeStart = normalizeTime(map.office_start_time) || normalizeTime(DEFAULT_START);
    const startMins = timeToMinutes(officeStart);
    // parseInt(grace) || 15 would turn a configured 0 back into 15.
    const graceRaw = parseInt(map.late_grace_period, 10);
    const graceMins = Number.isFinite(graceRaw) && graceRaw >= 0 ? graceRaw : DEFAULT_GRACE;

    return {
        officeStart,
        graceMins,
        lateCutoffMins: startMins + graceMins,
        halfDayCutoffMins: HALF_DAY_CUTOFF_MINS
    };
}

function classifyCheckIn(minutes, policy) {
    if (minutes === null || minutes === undefined) return 'present';
    if (minutes <= policy.lateCutoffMins) return 'present';
    if (minutes <= policy.halfDayCutoffMins) return 'late';
    return 'half-day';
}

function stripAutoMarkers(remarks) {
    const s = String(remarks || '').trim();
    if (!s) return null;
    const cleaned = s
        .replace(HD4_MARKER_RE, '')
        .replace(AFTER_NOON_RE, '')
        .replace(/^[\s;]+/, '')
        .replace(/[\s;]+$/, '')
        .trim();
    return cleaned || null;
}

// Lates already recorded this month. HD4 rows (status half-day + marker
// remark) are lates too, otherwise the monthly counter resets after the 4th.
async function countMonthLates(employeeId, monthStart, beforeDate) {
    const result = await query(
        `SELECT COUNT(*) AS count FROM attendance
         WHERE employee_id = $1 AND date >= $2 AND date < $3
           AND (status = 'late' OR (status = 'half-day' AND remarks ~* $4))`,
        [employeeId, monthStart, beforeDate, HD4_MARKER_SQL]
    );
    return parseInt(result.rows[0].count, 10) || 0;
}

async function resolveCheckIn({ employeeId, date, time }) {
    const policy = await getPolicy();
    const minutes = timeToMinutes(time);
    const baseStatus = classifyCheckIn(minutes, policy);
    const monthStart = String(date).slice(0, 7) + '-01';
    const latesBefore = await countMonthLates(employeeId, monthStart, date);

    const resolved = {
        policy,
        status: baseStatus,
        lateNumber: null,
        latesBefore,
        halfDayDueToLates: false,
        remarks: null
    };

    if (baseStatus === 'late') {
        const next = latesBefore + 1;
        resolved.lateNumber = next;
        if (next >= 4) {
            resolved.status = 'half-day';
            resolved.halfDayDueToLates = true;
            resolved.remarks = `${ordinal(next)} late - auto half day`;
        }
    } else if (baseStatus === 'half-day') {
        resolved.remarks = 'Checked in after 12:00 - half day';
    }

    return resolved;
}

module.exports = {
    getPolicy,
    classifyCheckIn,
    countMonthLates,
    resolveCheckIn,
    stripAutoMarkers,
    minutesToLabel,
    timeToMinutes,
    normalizeTime,
    ordinal,
    HALF_DAY_CUTOFF_MINS,
    HD4_MARKER_RE,
    HD4_MARKER_SQL
};
