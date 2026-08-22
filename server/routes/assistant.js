const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../utils/rateLimit');
const { istDateString, istYear } = require('../utils/date');

// "Ask Gensar" - a lightweight HR assistant. Employees type questions in
// English or Tenglish; an intent matcher picks a handler that runs read-only
// queries against the caller's own data and answers in short sentences plus
// optional action buttons (rendered by the front-end widget).

const queryLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 40,
    keyFn: (req) => 'assist:' + (req.user ? req.user.id : clientIp(req)),
    message: 'You are asking too many questions. Please wait a bit.'
});

function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[?!,.\u20b9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function hitsAny(text, words) {
    let score = 0;
    for (const w of words) {
        if (text.includes(w)) score += w.includes(' ') ? 2 : 1;
    }
    return score;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d) {
    return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------- intents

const INTENTS = [
    {
        name: 'help',
        keywords: ['help', 'em cheyyochu', 'what can you do', 'menu', 'options'],
        priority: 90,
        handler: async () => ({
            reply: 'I can help you with:\n\u2022 Leave balances & applying leave/WFH\n\u2022 Your attendance summary\n\u2022 Holidays list\n\u2022 Payslip download\n\u2022 Request statuses\n\u2022 Birthdays & your TL details\nAsk me anything, or tap a suggestion below.',
            chips: ['Leave balance', 'My attendance', 'Next holidays', 'Payslip', 'Request status']
        })
    },
    {
        name: 'leave_balance',
        keywords: ['leave balance', 'balance entha', 'leave enka', 'leave migila', 'cl balance', 'el balance', 'sl balance', 'how many leaves', 'leaves left', 'leaves remaining', 'leave days left', 'casual leave'],
        priority: 80,
        handler: async (req) => {
            const user = await query('SELECT gender FROM employees WHERE id = $1', [req.user.id]);
            const gender = user.rows[0]?.gender || 'all';
            const result = await query(
                `SELECT lt.name, lt.days_per_year,
                COALESCE(SUM(la.total_days), 0) AS used_days
                FROM leave_types lt
                LEFT JOIN leave_applications la ON lt.id = la.leave_type_id
                    AND la.employee_id = $1
                    AND to_char(la.start_date, 'YYYY') = $2
                    AND la.status IN ('approved', 'pending')
                WHERE lt.is_active = 1 AND (lt.gender_eligibility = 'all' OR lt.gender_eligibility = $3)
                GROUP BY lt.id, lt.name, lt.days_per_year
                ORDER BY lt.name`,
                [req.user.id, String(istYear()), gender]
            );
            if (result.rows.length === 0) return { reply: 'No leave types configured yet.' };
            const lines = result.rows.map(r =>
                `\u2022 ${r.name}: ${r.days_per_year - r.used_days} of ${r.days_per_year} days left`
            );
            return {
                reply: `Your ${istYear()} leave balance:\n${lines.join('\n')}`,
                actions: [{ label: 'Apply Leave', url: '/pages/employee/leave.html' }]
            };
        }
    },
    {
        name: 'apply_wfh',
        keywords: ['wfh apply', 'apply wfh', 'wfh kavali', 'work from home apply', 'wfh request'],
        priority: 82,
        handler: async () => ({
            reply: 'WFH requests lo ikkada apply cheyyachu. Manager approve chesthadu.',
            actions: [{ label: 'Apply WFH', url: '/pages/employee/wfh.html' }]
        })
    },
    {
        name: 'apply_leave',
        keywords: ['apply leave', 'leave apply', 'leave kavali', 'leave kavala', 'take leave', 'permission kavali', 'leave pettali', 'leave istam'],
        priority: 81,
        handler: async () => ({
            reply: 'Leave apply cheyyadaniki Leave page open cheyyi. Type select chesi dates ivvi - manager ki approval ki velthundi.',
            actions: [{ label: 'Open Leave Page', url: '/pages/employee/leave.html' }],
            chips: ['Leave balance']
        })
    },
    {
        name: 'today_status',
        keywords: ['today attendance', 'today status', 'eeroju attendance', 'eeroju status', 'check in ayyana', 'in chesava', 'nenu in', 'my check-in', 'checked in'],
        priority: 85,
        handler: async (req) => {
            const today = istDateString();
            const result = await query(
                'SELECT check_in, check_out, break_start, break_end, status FROM attendance WHERE employee_id = $1 AND date = $2 LIMIT 1',
                [req.user.id, today]
            );
            const row = result.rows[0];
            if (!row) {
                return { reply: `Eeroju (${fmtDate(new Date(today))}) attendance record avvaledu. Check-in cheyyandi!`,
                    actions: [{ label: 'Go to Attendance', url: '/pages/employee/attendance.html' }] };
            }
            let reply = `Eeroju status: ${row.status}`;
            if (row.check_in) reply += `\n\u23F0 Check-in: ${String(row.check_in).slice(0, 5)}`;
            if (row.check_out) reply += `\n\ud83c\udfc1 Check-out: ${String(row.check_out).slice(0, 5)}`;
            else reply += '\nCheck-out avvaledu.';
            if (row.break_start && !row.break_end) reply += '\n\ud83d\udcf1 Break running!';
            return {
                reply,
                actions: [{ label: 'Open Attendance', url: '/pages/employee/attendance.html' }]
            };
        }
    },
    {
        name: 'next_holidays',
        keywords: ['holiday', 'holidays', 'selu', 'jandal', 'public holiday', 'next holiday eppudu', 'vacation list'],
        priority: 70,
        handler: async () => {
            const today = new Date().toISOString().slice(0, 10);
            const result = await query(
                `SELECT name, date FROM holidays WHERE is_active = 1 AND date >= $1 ORDER BY date LIMIT 4`,
                [today]
            );
            if (result.rows.length === 0) return { reply: 'Upcoming holidays database lo ledu.' };
            const lines = result.rows.map(h => {
                const d = fmtDate(new Date(h.date));
                const dayName = new Date(h.date).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
                return `\u2022 ${h.name} - ${d} (${dayName})`;
            });
            return {
                reply: `Upcoming holidays:\n${lines.join('\n')}`,
                actions: [{ label: 'Holiday Calendar', url: '/pages/employee/holidays.html' }]
            };
        }
    },
    {
        name: 'latest_payslip',
        keywords: ['payslip', 'pay slip', 'salary slip', 'salary pdf', 'salary download', 'salary document', 'jop', 'salary letter'],
        priority: 75,
        handler: async (req) => {
            const result = await query(
                `SELECT id, month, year, net_salary FROM payroll WHERE employee_id = $1 ORDER BY year DESC, month DESC LIMIT 1`,
                [req.user.id]
            );
            const p = result.rows[0];
            if (!p) return { reply: 'Mee payslips ippati varaku generate avvaledu. Payroll process ayaka ikkada kanipistundi.' };
            return {
                reply: `Latest payslip: ${MONTHS[p.month - 1]} ${p.year}\nNet salary: \u20B9${Number(p.net_salary || 0).toLocaleString('en-IN')}`,
                actions: [{ label: 'Download PDF', url: `/api/payroll/${p.id}/pdf` }]
            };
        }
    },
    {
        name: 'birthdays',
        keywords: ['birthday', 'bday', 'puttina roju', 'birthday evaru', 'celebration'],
        priority: 60,
        handler: async () => {
            const today = new Date();
            const result = await query(
                `SELECT first_name, last_name, employee_id, date_of_birth
                FROM employees WHERE status = 'active' AND date_of_birth IS NOT NULL`
            );
            const list = [];
            for (const e of result.rows) {
                let next = new Date(Date.UTC(today.getUTCFullYear(), e.date_of_birth.getUTCMonth(), e.date_of_birth.getUTCDate()));
                if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, e.date_of_birth.getUTCMonth(), e.date_of_birth.getUTCDate()));
                const daysAway = Math.round((next - today) / 86400000);
                if (daysAway <= 30) list.push({ name: `${e.first_name} ${e.last_name}`, d: fmtDate(next), daysAway });
            }
            list.sort((a, b) => a.daysAway - b.daysAway);
            if (list.length === 0) return { reply: 'Next 30 days lo birthdays levu.' };
            return {
                reply: 'Upcoming birthdays \ud83c\udf82:\n' + list.map(b => `\u2022 ${b.name} - ${b.d}`).join('\n')
            };
        }
    },
    {
        name: 'my_manager',
        keywords: ['naa tl', 'my tl', 'my manager', 'manager evaru', 'reporting manager', 'who is my lead', 'team lead evaru', 'naa manager'],
        priority: 65,
        handler: async (req) => {
            const result = await query(
                `SELECT rm.first_name, rm.last_name, rm.email, d.name AS dept
                FROM employees e
                LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
                LEFT JOIN departments d ON d.id = rm.department_id
                WHERE e.id = $1`,
                [req.user.id]
            );
            const m = result.rows[0];
            if (!m || !m.first_name) return { reply: 'Mee reporting manager database lo assign avvaledu. Admin ni adagandi.' };
            return { reply: `Mee TL: ${m.first_name} ${m.last_name}${m.dept ? ` (${m.dept})` : ''}` };
        }
    },
    {
        name: 'my_requests',
        keywords: ['request status', 'pending naavi', 'naa requests', 'my requests', 'approved naa', 'application status', 'ticket status', 'naa applications'],
        priority: 72,
        handler: async (req) => {
            const [leaves, wfh, tickets, regs] = await Promise.all([
                query(`SELECT status, COUNT(*)::int AS n FROM leave_applications WHERE employee_id = $1 GROUP BY status`, [req.user.id]),
                query(`SELECT status, COUNT(*)::int AS n FROM wfh_requests WHERE employee_id = $1 GROUP BY status`, [req.user.id]),
                query(`SELECT status, COUNT(*)::int AS n FROM support_tickets WHERE employee_id = $1 GROUP BY status`, [req.user.id]).catch(() => ({ rows: [] })),
                runSafe(() => query(`SELECT status, COUNT(*)::int AS n FROM attendance_regularizations WHERE employee_id = $1 GROUP BY status`, [req.user.id]))
            ]);
            const summarize = (rows, label) => {
                if (!rows || rows.length === 0) return null;
                const parts = rows.map(r => `${r.n} ${r.status}`);
                return `${label}: ${parts.join(', ')}`;
            };
            const lines = [
                summarize(leaves.rows, 'Leaves'),
                summarize(wfh.rows, 'WFH'),
                summarize(tickets.rows, 'Queries'),
                summarize(regs.rows, 'Regularizations')
            ].filter(Boolean);
            return {
                reply: lines.length ? `Mee requests:\n${lines.map(l => `\u2022 ${l}`).join('\n')}` : 'Mee requests em levu.',
                actions: [{ label: 'View Requests', url: '/pages/employee/dashboard.html' }]
            };
        }
    },
    {
        name: 'attendance_month',
        keywords: ['attendance', 'present days', 'hajri', 'my attendance', 'naa attendance', 'this month attendance', 'month attendance', 'how many days present', 'absent days', 'late count', 'late enni'],
        priority: 74,
        handler: async (req) => {
            const now = new Date(Date.now() + 5.5 * 3600 * 1000);
            const month = String(now.getUTCMonth() + 1).padStart(2, '0');
            const year = String(now.getUTCFullYear());
            const result = await query(
                `SELECT status, COUNT(*)::int AS n FROM attendance
                WHERE employee_id = $1 AND to_char(date, 'MM') = $2 AND to_char(date, 'YYYY') = $3
                GROUP BY status`,
                [req.user.id, month, year]
            );
            const map = {};
            for (const r of result.rows) map[r.status] = r.n;
            const presentish = (map.present || 0) + (map.late || 0) + (map['half-day'] || 0) * 0.5;
            const workingDays = presentish + (map.absent || 0) + (map.leave ? map.leave : 0);
            let reply = `${MONTHS[parseInt(month, 10) - 1]} ${year} attendance:\n`;
            reply += `\u2022 Present: ${(map.present || 0)}\n\u2022 Late: ${(map.late || 0)}\n\u2022 Half-day: ${(map['half-day'] || 0)}\n\u2022 Absent: ${(map.absent || 0)}`;
            if (workingDays > 0) reply += `\n\ud83d\udcc8 Attendance rate: ${Math.round((presentish / workingDays) * 100)}%`;
            return {
                reply,
                actions: [{ label: 'Full Attendance', url: '/pages/employee/attendance.html' }]
            };
        }
    },
    {
        name: 'find_person',
        keywords: ['who is ', 'evaru ', 'contact ', 'email of ', 'number of '],
        priority: 50,
        handler: async (req, text) => {
            // Extract the person's name from the question ("who is ravi",
            // "contact sudheer", or Tenglish reverse order "ramesh evaru").
            let namePart = '';
            const m = text.match(/(?:who is|evaru|contact|email of|number of)\s+([a-z][a-z ]{1,30})/);
            if (m && m[1]) {
                namePart = m[1].trim();
            } else {
                const rev = text.match(/^([a-z]{2,20})(?:\s+[a-z]{2,20})?\s+evaru\b/);
                if (rev && rev[1] && !['naa', 'my', 'team'].includes(rev[1])) namePart = rev[1];
            }
            if (!namePart) return { reply: 'Evaru vetakali? Name cheppandi - example: "who is ravi"' };

            // Mirror the directory scope rules so people only discover their own team.
            const meRes = await query('SELECT role, reporting_manager_id FROM employees WHERE id = $1', [req.user.id]);
            const me = meRes.rows[0];
            if (!me) return { reply: 'Search cheyyaleni. Malli try cheyyandi.' };

            let scopeSql;
            const params = [`%${namePart}%`];
            if (me.role === 'admin') {
                scopeSql = '';
            } else if (me.role === 'manager' || me.role === 'team_lead') {
                scopeSql = ' AND (e.reporting_manager_id = $2)';
                params.push(req.user.id);
            } else if (me.reporting_manager_id) {
                scopeSql = ' AND (e.reporting_manager_id = $2 OR e.id = $2)';
                params.push(me.reporting_manager_id);
            } else {
                scopeSql = '';
            }

            const result = await query(
                `SELECT e.first_name, e.last_name, g.name AS designation, d.name AS department
                FROM employees e
                LEFT JOIN designations g ON g.id = e.designation_id
                LEFT JOIN departments d ON d.id = e.department_id
                WHERE e.status = 'active'
                  AND (LOWER(e.first_name) LIKE LOWER($1) OR LOWER(e.last_name) LIKE LOWER($1))${scopeSql}
                LIMIT 3`,
                params
            );
            if (result.rows.length === 0) {
                return { reply: `"${namePart}" ani mee team lo evaru dorakaledu.` };
            }
            const lines = result.rows.map(p =>
                `\u2022 ${p.first_name} ${p.last_name}${p.designation ? ` - ${p.designation}` : ''}${p.department ? `, ${p.department}` : ''}`
            );
            return {
                reply: `Team members dorikaru:\n${lines.join('\n')}\nContact details kosam Directory page chudandi.`,
                actions: [{ label: 'Open Directory', url: '/pages/employee/directory.html' }]
            };
        }
    },
    {
        name: 'team_pending',
        keywords: ['team pending', 'pending approvals', 'team requests', 'approvals enni', 'team today', 'team attendance'],
        priority: 78,
        handler: async (req) => {
            if (!['admin', 'hr', 'manager', 'team_lead'].includes(req.user.role)) {
                return { reply: 'Idi managers kosam matrame feature. Mee requests kosam "request status" ani adagandi.', chips: ['Request status'] };
            }
            const [leaves, wfh, regs] = await Promise.all([
                query(`SELECT COUNT(*)::int AS n FROM leave_applications WHERE status = 'pending'`),
                query(`SELECT COUNT(*)::int AS n FROM wfh_requests WHERE status = 'pending'`),
                runSafe(() => query(`SELECT COUNT(*)::int AS n FROM attendance_regularizations WHERE status = 'pending'`))
            ]);
            const total = (leaves.rows[0]?.n || 0) + (wfh.rows[0]?.n || 0) + (regs.rows[0]?.n || 0);
            let reply = `Pending approvals:\n\u2022 Leaves: ${leaves.rows[0]?.n || 0}\n\u2022 WFH: ${wfh.rows[0]?.n || 0}\n\u2022 Regularizations: ${regs.rows[0]?.n || 0}`;
            if (total === 0) reply += '\nAnni clear! \ud83c\udf89';
            return {
                reply,
                actions: [{ label: 'Review Requests', url: '/pages/manager/my-team.html' }]
            };
        }
    }
];

async function runSafe(fn) {
    try { return await fn(); } catch (_) { return { rows: [] }; }
}

// --------------------------------------------------------------- matching

function pickIntent(text) {
    let best = null;
    let bestScore = 0;
    for (const intent of INTENTS) {
        const score = hitsAny(text, intent.keywords) + (intent.priority || 0) / 1000;
        if (score > bestScore) {
            bestScore = score;
            best = intent;
        }
    }
    return bestScore >= 1 ? best : null;
}

router.post('/query', verifyToken, queryLimiter, async (req, res) => {
    try {
        const raw = String((req.body && req.body.message) || '');
        const text = normalize(raw);

        if (!text) {
            return res.json({ success: true, reply: 'Em adagaliru? Type cheyyandi.', chips: ['Help'] });
        }

        const intent = pickIntent(text);
        if (!intent) {
            return res.json({
                success: true,
                reply: 'Sorry, adi ardham kaledu \ud83e\udd7a Nenu ee vishayallo help chestanu:',
                chips: ['Leave balance', 'My attendance', 'Next holidays', 'Payslip', 'Request status', 'Help']
            });
        }

        const data = await intent.handler(req, text);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('Assistant error:', error.message);
        res.status(500).json({ success: false, message: 'Assistant failed. Try again.' });
    }
});

module.exports = router;
