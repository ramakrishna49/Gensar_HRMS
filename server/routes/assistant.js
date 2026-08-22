const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../utils/rateLimit');
const { istDateString, istYear } = require('../utils/date');

// "Ask Gensar" - a lightweight HR assistant. Employees type questions in
// English, Tenglish or Telugu script; an intent matcher picks a handler that
// runs read-only queries against the caller's own data and answers in the
// SAME language the question was asked in, plus optional action buttons
// rendered by the front-end widget.

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

function detectLang(text) {
    // Telugu script block.
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
    // Common Tenglish markers - if present answer in Tenglish, otherwise English.
    const markers = ['entha', 'evaru', 'eppudu', 'kavali', 'kavala', 'cheppu', 'chudu', 'cheyyali',
        'naa', 'mera', 'em ', 'emi', 'ledu', 'undi', 'chesava', 'chesanu', 'migila', 'enka',
        'hajri', 'selu', 'jandal', 'pettali', 'istam', 'ardam', 'ayyava', 'adug', 'vachindi'];
    if (markers.some((m) => text.includes(m))) return 'tg';
    return 'en';
}

// Picks the reply variant for the detected language (falls back to Tenglish,
// then English).
function pick(lang, strs) {
    return strs[lang] || strs.tg || strs.en;
}

function hitsAny(text, words) {
    let score = 0;
    for (const w of words) {
        if (w.length <= 3) {
            // Short words like "hi" must match whole words only, otherwise they
            // hit substrings of unrelated text ("this", "which", ...).
            if (new RegExp('\\b' + w + '\\b').test(text)) score += 1;
        } else if (text.includes(w)) {
            score += w.includes(' ') ? 2 : 1;
        }
    }
    return score;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(d) {
    return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function istHour() {
    return new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
}

async function runSafe(fn) {
    try { return await fn(); } catch (_) { return { rows: [] }; }
}

// ---------------------------------------------------------------- intents

const INTENTS = [
    {
        name: 'smalltalk',
        priority: 95,
        handler: async (req, text) => {
            const h = istHour();
            const greet = h < 12 ? { en: 'Good morning!', tg: 'Good morning bhai!', te: '\u0db6 \u0c36\u0c41\u0c2d\u0c4b\u0c26\u0c2f\u0c02!' }
                : h < 17 ? { en: 'Good afternoon!', tg: 'Good afternoon bhai!', te: '\u0c36\u0c41\u0c2d \u0c2e\u0c27\u0c4d\u0c2f\u0c3e\u0c39\u0c4d\u0c28\u0c02!' }
                    : { en: 'Good evening!', tg: 'Good evening bhai!', te: '\u0c36\u0c41\u0c2d \u0c38\u0c3e\u0c2f\u0c02\u0c24\u0c4d\u0c30\u0c02!' };

            // Sub-intents inside casual chat.
            if (/how\s*are\s*(you|u)\b|\u0c0e\u0c32\u0c3e\s*\u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c30\u0c41/.test(text)) {
                return {
                    reply: pick(detectLang(text), {
                        en: "I'm doing great, thanks for asking! 😄 Always ready to help with your HR stuff. How are you doing?",
                        tg: 'Nenu super ga unnanu 😄 Mee HR panulu cheskuntu unnanu. Meeru ela unnaru?',
                        te: '\u0c28\u0c47\u0c28\u0c41 \u0c15\u0c46\u0c35\u0c4d\u0c35\u0c30\u0c4d\u200c\u0c17\u0c3e \u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c28\u0c41! \u0c2e\u0c40\u0c30\u0c41 \u0c0e\u0c32\u0c3e \u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c30\u0c41?'
                    }),
                    chips: ['Leave balance', 'My attendance']
                };
            }
            if (/what\s*(are|r)\s*(you|u)\s*(doing|do)\b|wt\s*(r|are)\s*(u|you)\s*doing|\u0c0f\u0c2e\u0c3f\s*\u0c1a\u0c37\u0c4d\u0c1f\u0c41\u0c28\u0c4d\u0c28\u0c3e\u0c35/.test(text)) {
                return {
                    reply: pick(detectLang(text), {
                        en: 'Just waiting for your questions! 🤖 Ask me about leave balance, attendance, holidays or payslips.',
                        tg: 'Mee questions ki wait chestu unnanu 🤖 Leave, attendance, holidays, payslips - emaina adagandi!',
                        te: '\u0c2e\u0c40 \u0c2a\u0c4d\u0c30\u0c36\u0c4d\u0c28\u0c32\u0c15\u0c41 \u0c35\u0c47\u0c1a\u0c3f \u0c09\u0c28\u0c4d\u0c28\u0c3e\u0c28\u0c41! \u0c0f\u0c26\u0c48\u0c28\u0c3e \u0c05\u0c21\u0c17\u0c02\u0c21\u0c3f!'
                    })
                };
            }
            if (/had\s*(your\s*)?lunch|lunch\s*a(yya|yyav|yyava)|\u0c2d\u0c4b\u0c1c\u0c28\u0c02\s*\u0c1a\u0c47\u0c38\u0c3e\u0c30\u0c41/.test(text)) {
                const lunchTime = h >= 12 && h < 16;
                const lang = detectLang(text);
                if (lang === 'te') return { reply: lunchTime ? '\u0c28\u0c47\u0c28\u0c41 \u0c30\u0c2d\u0c3e\u0c1f\u0c4d \u0c2d\u0c3e\u0c2f\u0c0d \u0c2e\u0c40\u0c15\u0c42 \u0c2d\u0c4b\u0c1c\u0c28\u0c02 \u0c1a\u0c47\u0c38\u0c41\u0c15\u0c4b\u0c02\u0c21\u0c3f! \ud83c\udf5b' : '\u0c07\u0c02\u0c15\u0c3e \u0c2d\u0c4b\u0c1c\u0c28\u0c02 \u0c1f\u0c48\u0c2e\u0c4d \u0c05\u0c35\u0c4d\u0c35\u0c32\u0c47\u0c26\u0c41 \u0c15\u0c26\u0c3e \ud83d\ude04' };
                return {
                    reply: pick(lang, {
                        en: lunchTime ? "Haha, I'm a robot - no lunch for me! 😄 But YOU should eat well. Bon appétit!"
                            : "It's not even lunch time yet! 😄 Save your appetite.",
                        tg: lunchTime ? 'Nenu robot bhai, tinnanu kada 😄 Meeru lunch ayyara? Fresh ga unndi!'
                            : 'Inka lunch time avvaledu kada 😄 Tarvata matruduvu!'
                    })
                };
            }
            if (/who\s*are\s*(you|u)\b|nuvv?\s*evaru|ne\s*p(eru|eru enti)/.test(text)) {
                return {
                    reply: pick(detectLang(text), {
                        en: "I'm Ask Gensar 🤖 - your HR assistant. Leave, attendance, payslips, holidays - ask me anything!",
                        tg: 'Nenu Ask Gensar 🤖 - mee HR assistant. Leave, attendance, payslips - emaina adagandi!',
                        te: '\u0c28\u0c47\u0c28\u0c41 Ask Gensar \ud83e\udd16 - \u0c2e\u0c40 HR \u0c38\u0c39\u0c3e\u0c2f\u0c15\u0c41\u0c21\u0c3f.'
                    }),
                    chips: ['Help']
                };
            }
            if (/thank(s|\s*you)?\b|thanks\b|dhanyavad|\u0c27\u0c28\u0c4d\u0c2f\u0c35\u0c3e\u0c26/.test(text)) {
                return {
                    reply: pick(detectLang(text), {
                        en: "Anytime! Happy to help 😊",
                        tg: 'Pleasure bhai! Inka emaina kavali ante adagandi 😊',
                        te: '\u0c0e\u0c2a\u0c4d\u0c2a\u0c41\u0c21\u0c48\u0c28\u0c3e! \u0c07\u0c02\u0c15 \u0c0f\u0c26\u0c48\u0c28\u0c3e \u0c15\u0c3e\u0c35\u0c3e\u0c32\u0c3f \u0c05\u0c02\u0c1f\u0c47 \u0c05\u0c21\u0c17\u0c02\u0c21\u0c3f \ud83d\ude0a'
                    })
                };
            }
            if (/\bbye\b|\bgood\s*night\b|\bsee you\b|velladan|\u0c35\u0c46\u0c33\u0c4d\u0c33\u0c3f\u0c2a\u0c4b\u0c24/.test(text)) {
                return {
                    reply: pick(detectLang(text), {
                        en: 'Bye! Take care 👋',
                        tg: 'Bye bhai! Take care 👋 Malli vastanu appudu!',
                        te: '\u0c35\u0c40\u0c23\u0c4d\u0c28\u0c3e! \u0c1c\u0c3e\u0c17\u0c4d\u0c30\u0c24\u0c4d\u0c24\u0c17\u0c41\u0c02\u0c21\u0c3f \ud83d\udc4b'
                    })
                };
            }

            // Generic greeting (hi/hello/hey/namaste).
            const lang = detectLang(text);
            return {
                reply: pick(lang, {
                    en: `${greet.en} I'm Ask Gensar 🤖 What can I do for you?`,
                    tg: `${greet.tg} Nenu Ask Gensar 🤖 Em saayam kavali?`,
                    te: `${greet.te} \u0c28\u0c47\u0c28\u0c41 Ask Gensar \ud83e\udd16 \u0c0f\u0c2e\u0c3f \u0c38\u0c39\u0c3e\u0c2f\u0c02 \u0c15\u0c3e\u0c35\u0c3e\u0c32\u0c3f?`
                }),
                chips: ['Leave balance', 'My attendance', 'Next holidays', 'Request status']
            };
        },
        keywords: []
    },
    {
        name: 'help',
        keywords: ['help', 'em cheyyochu', 'what can you do', 'menu', 'options'],
        priority: 90,
        handler: async () => ({
            reply: pick('tg', {
                en: 'I can help with:\n\u2022 Leave balances & applying leave/WFH\n\u2022 Attendance summary\n\u2022 Holidays\n\u2022 Payslip download\n\u2022 Request statuses\n\u2022 Birthdays & TL details\nAsk anything, or tap a suggestion.',
                tg: 'Idigo nenu cheyyagala vi:\n\u2022 Leave balances & leave/WFH apply\n\u2022 Attendance summary\n\u2022 Holidays\n\u2022 Payslip download\n\u2022 Request statuses\n\u2022 Birthdays & TL details\nEmaina adagandi, leda kindha suggestion tap cheyyandi.'
            }),
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
            if (result.rows.length === 0) {
                return { reply: 'No leave types configured yet.' };
            }
            const lines = result.rows.map((r) =>
                `\u2022 ${r.name}: ${r.days_per_year - r.used_days} / ${r.days_per_year}`
            );
            return {
                reply: pick('tg', {
                    en: `Your ${istYear()} leave balance:\n${lines.join('\n')}`,
                    tg: `Mee ${istYear()} leave balance:\n${lines.join('\n')}`
                }),
                actions: [{ label: 'Apply Leave', url: '/pages/employee/leave.html' }]
            };
        }
    },
    {
        name: 'apply_wfh',
        keywords: ['wfh apply', 'apply wfh', 'wfh kavali', 'work from home apply', 'wfh request'],
        priority: 82,
        handler: async (req, text, lang) => {
            return {
                reply: pick(lang, {
                    en: 'You can raise a WFH request on the WFH page. Your manager will approve it.',
                    tg: 'WFH page lo request pettandi. Manager approve chestadu.',
                    te: 'WFH \u0c2a\u0c47\u0c1c\u0c40\u0c32\u0c4b \u0c30\u0c3f\u0c15\u0c4d\u0c35\u0c46\u0c37\u0c4d\u0c1f\u0c4d \u0c2a\u0c46\u0c1f\u0c4d\u0c1f\u0c02\u0c21\u0c3f.'
                }),
                actions: [{ label: 'Apply WFH', url: '/pages/employee/wfh.html' }]
            };
        }
    },
    {
        name: 'apply_leave',
        keywords: ['apply leave', 'leave apply', 'leave kavali', 'leave kavala', 'take leave', 'permission kavali', 'leave pettali', 'leave istam'],
        priority: 81,
        handler: async (req, text, lang) => {
            return {
                reply: pick(lang, {
                    en: 'Open the Leave page, pick a leave type and dates - it goes to your manager for approval.',
                    tg: 'Leave page open cheyyi, type & dates select cheyyi - manager ki approval ki velthundi.',
                    te: '\u0c32\u0c40\u0c35\u0c4d \u0c2a\u0c47\u0c1c\u0c40 \u0c13\u0c2a\u0c46\u0c28\u0c4d \u0c1a\u0c47\u0c2f\u0c02\u0c21\u0c3f, \u0c24\u0c47\u0c26\u0c40\u0c32\u0c41 \u0c38\u0c46\u0c32\u0c15\u0c4d\u0c1f\u0c4d \u0c1a\u0c47\u0c2f\u0c02\u0c21\u0c3f - \u0c2e\u0c4d\u0c2f\u0c3e\u0c28\u0c47\u0c1c\u0c30\u0c4d \u0c06\u0c2e\u0c27\u0c4d\u0c2f\u0c15\u0c02 \u0c1a\u0c47\u0c38\u0c4d\u0c24\u0c3e\u0c30\u0c41.'
                }),
                actions: [{ label: 'Open Leave Page', url: '/pages/employee/leave.html' }],
                chips: ['Leave balance']
            };
        }
    },
    {
        name: 'today_status',
        keywords: ['today attendance', 'today status', 'eeroju attendance', 'eeroju status', 'check in ayyana', 'in chesava', 'nenu in', 'my check-in', 'checked in'],
        priority: 85,
        handler: async (req, text, lang) => {
            const today = istDateString();
            const result = await query(
                'SELECT check_in, check_out, break_start, break_end, status FROM attendance WHERE employee_id = $1 AND date = $2 LIMIT 1',
                [req.user.id, today]
            );
            const row = result.rows[0];
            if (!row) {
                return {
                    reply: pick(lang, {
                        en: `No attendance recorded yet today (${fmtDate(new Date(today))}). Please check in!`,
                        tg: `Eeroju (${fmtDate(new Date(today))}) record avvaledu. Check-in cheyyandi!`
                    }),
                    actions: [{ label: 'Go to Attendance', url: '/pages/employee/attendance.html' }]
                };
            }
            let reply;
            if (lang === 'te') {
                reply = `\u0c08\u0c30\u0c4b\u0c1c\u0c41 \u0c38\u0c4d\u0c1f\u0c47\u0c1f\u0c38\u0c4d: ${row.status}`;
            } else {
                reply = pick(lang, { en: `Today's status: ${row.status}`, tg: `Eeroju status: ${row.status}` });
            }
            if (row.check_in) reply += `\n\u23F0 ${lang === 'te' ? '\u0c1a\u0c46\u0c15\u0c4d-\u0c07\u0c28\u0c4d' : 'Check-in'}: ${String(row.check_in).slice(0, 5)}`;
            if (row.check_out) reply += `\n\ud83c\udfc1 ${lang === 'te' ? '\u0c1a\u0c46\u0c15\u0c4d-\u0c06\u0c2f\u0c1f\u0c4d' : 'Check-out'}: ${String(row.check_out).slice(0, 5)}`;
            else reply += lang === 'te' ? '\n\u0c1a\u0c46\u0c15\u0c4d-\u0c06\u0c2f\u0c1f\u0c4d \u0c05\u0c35\u0c4d\u0c35\u0c32\u0c47\u0c26\u0c41.' : pick(lang, { en: '\nNot checked out yet.', tg: '\nCheck-out avvaledu.' });
            if (row.break_start && !row.break_end) reply += '\n\ud83d\udcf1 Break running!';
            return {
                reply,
                actions: [{ label: 'Open Attendance', url: '/pages/employee/attendance.html' }]
            };
        }
    },
    {
        name: 'next_holidays',
        keywords: ['holiday', 'holidays', 'selu', 'jandal', 'public holiday', 'vacation list'],
        priority: 70,
        handler: async (req) => {
            const today = new Date().toISOString().slice(0, 10);
            const result = await query(
                `SELECT name, date FROM holidays WHERE is_active = 1 AND date >= $1 ORDER BY date LIMIT 4`,
                [today]
            );
            if (result.rows.length === 0) {
                return { reply: pick(lang, { en: 'No upcoming holidays in the database.', tg: 'Upcoming holidays database lo ledu.' }) };
            }
            const lines = result.rows.map((hl) => {
                const d = fmtDate(new Date(hl.date));
                const dayName = new Date(hl.date).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
                return `\u2022 ${hl.name} - ${d} (${dayName})`;
            });
            return {
                reply: pick(lang, {
                    en: `Upcoming holidays:\n${lines.join('\n')}`,
                    tg: `Vachhe holidays:\n${lines.join('\n')}`,
                    te: `\u0c30\u0c3e\u0c2c\u0c4b\u0c1a\u0c41 \u0c38\u0c46\u0c32\u0c41\u0c21\u0c41\u0c32\u0c41:\n${lines.join('\n')}`
                }),
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
            if (!p) {
                return { reply: pick('tg', { en: 'No payslips generated yet.', tg: 'Mee payslips ippati varaku generate avvaledu.' }) };
            }
            return {
                reply: pick('tg', {
                    en: `Latest payslip: ${MONTHS[p.month - 1]} ${p.year}\nNet salary: \u20B9${Number(p.net_salary || 0).toLocaleString('en-IN')}`,
                    tg: `Latest payslip: ${MONTHS[p.month - 1]} ${p.year}\nNet salary: \u20B9${Number(p.net_salary || 0).toLocaleString('en-IN')}`
                }),
                actions: [{ label: 'Download PDF', url: `/api/payroll/${p.id}/pdf` }]
            };
        }
    },
    {
        name: 'birthdays',
        keywords: ['birthday', 'bday', 'puttina roju', 'celebration'],
        priority: 60,
        handler: async (req) => {
            const today = new Date();
            const result = await query(
                `SELECT first_name, last_name, date_of_birth FROM employees WHERE status = 'active' AND date_of_birth IS NOT NULL`
            );
            const list = [];
            for (const e of result.rows) {
                let next = new Date(Date.UTC(today.getUTCFullYear(), e.date_of_birth.getUTCMonth(), e.date_of_birth.getUTCDate()));
                if (next < today) next = new Date(Date.UTC(today.getUTCFullYear() + 1, e.date_of_birth.getUTCMonth(), e.date_of_birth.getUTCDate()));
                const daysAway = Math.round((next - today) / 86400000);
                if (daysAway <= 30) list.push({ name: `${e.first_name} ${e.last_name}`, d: fmtDate(next), daysAway });
            }
            list.sort((a, b) => a.daysAway - b.daysAway);
            if (list.length === 0) {
                return { reply: pick('tg', { en: 'No birthdays in the next 30 days.', tg: 'Next 30 days lo birthdays levu.' }) };
            }
            return {
                reply: pick('tg', {
                    en: 'Upcoming birthdays \ud83c\udf82:\n' + list.map((b) => `\u2022 ${b.name} - ${b.d}`).join('\n'),
                    tg: 'Upcoming birthdays \ud83c\udf82:\n' + list.map((b) => `\u2022 ${b.name} - ${b.d}`).join('\n')
                })
            };
        }
    },
    {
        name: 'my_manager',
        keywords: ['naa tl', 'my tl', 'my manager', 'manager evaru', 'reporting manager', 'who is my lead', 'team lead evaru', 'naa manager'],
        priority: 65,
        handler: async (req) => {
            const result = await query(
                `SELECT rm.first_name, rm.last_name, d.name AS dept
                FROM employees e
                LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
                LEFT JOIN departments d ON d.id = rm.department_id
                WHERE e.id = $1`,
                [req.user.id]
            );
            const m = result.rows[0];
            if (!m || !m.first_name) {
                return { reply: pick('tg', { en: 'No reporting manager assigned to you yet.', tg: 'Mee reporting manager assign avvaledu. Admin ni adagandi.' }) };
            }
            return {
                reply: pick('tg', {
                    en: `Your TL: ${m.first_name} ${m.last_name}${m.dept ? ` (${m.dept})` : ''}`,
                    tg: `Mee TL: ${m.first_name} ${m.last_name}${m.dept ? ` (${m.dept})` : ''}`
                })
            };
        }
    },
    {
        name: 'my_requests',
        keywords: ['request status', 'pending naavi', 'naa requests', 'my requests', 'application status', 'ticket status', 'naa applications'],
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
                return `${label}: ${rows.map((r) => `${r.n} ${r.status}`).join(', ')}`;
            };
            const lines = [
                summarize(leaves.rows, 'Leaves'),
                summarize(wfh.rows, 'WFH'),
                summarize(tickets.rows, 'Queries'),
                summarize(regs.rows, 'Regularizations')
            ].filter(Boolean);
            return {
                reply: lines.length
                    ? pick('tg', { en: 'Your requests:\n' + lines.map((l) => `\u2022 ${l}`).join('\n'), tg: 'Mee requests:\n' + lines.map((l) => `\u2022 ${l}`).join('\n') })
                    : pick('tg', { en: 'You have no requests yet.', tg: 'Mee requests em levu.' }),
                actions: [{ label: 'View Requests', url: '/pages/employee/dashboard.html' }]
            };
        }
    },
    {
        name: 'attendance_month',
        keywords: ['attendance', 'present days', 'hajri', 'my attendance', 'naa attendance', 'this month attendance', 'how many days present', 'absent days', 'late count', 'late enni'],
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
            const workingDays = presentish + (map.absent || 0);
            let reply = pick('tg', { en: `${MONTHS[parseInt(month, 10) - 1]} ${year} attendance:\n`, tg: `${MONTHS[parseInt(month, 10) - 1]} ${year} attendance:\n` });
            reply += `\u2022 Present: ${map.present || 0}\n\u2022 Late: ${map.late || 0}\n\u2022 Half-day: ${map['half-day'] || 0}\n\u2022 Absent: ${map.absent || 0}`;
            if (workingDays > 0) reply += `\n\ud83d\udcc8 ${pick('tg', { en: 'Attendance rate', tg: 'Attendance rate' })}: ${Math.round((presentish / workingDays) * 100)}%`;
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
            let namePart = '';
            const m = text.match(/(?:who is|evaru|contact|email of|number of)\s+([a-z][a-z ]{1,30})/);
            if (m && m[1]) {
                namePart = m[1].trim();
            } else {
                const rev = text.match(/^([a-z]{2,20})(?:\s+[a-z]{2,20})?\s+evaru\b/);
                if (rev && rev[1] && !['naa', 'my', 'team'].includes(rev[1])) namePart = rev[1];
            }
            if (!namePart) {
                return { reply: pick('tg', { en: 'Who should I look up? Example: "who is ravi"', tg: 'Evaru vetakali? Name cheppandi - example: "who is ravi"' }) };
            }

            const meRes = await query('SELECT role, reporting_manager_id FROM employees WHERE id = $1', [req.user.id]);
            const me = meRes.rows[0];
            if (!me) return { reply: pick('tg', { en: 'Search failed, please retry.', tg: 'Search cheyyaleni. Malli try cheyyandi.' }) };

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
                return { reply: pick('tg', { en: `"${namePart}" not found in your team.`, tg: `"${namePart}" ani mee team lo evaru dorakaledu.` }) };
            }
            const lines = result.rows.map((pr) =>
                `\u2022 ${pr.first_name} ${pr.last_name}${pr.designation ? ` - ${pr.designation}` : ''}${pr.department ? `, ${pr.department}` : ''}`
            );
            return {
                reply: pick('tg', {
                    en: `Found:\n${lines.join('\n')}\nContact details are on the Directory page.`,
                    tg: `Dorikaru:\n${lines.join('\n')}\nContact details Directory page lo chudandi.`
                }),
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
                return {
                    reply: pick('tg', {
                        en: 'That one is for managers. For your own requests ask "request status".',
                        tg: 'Idi managers kosam matrame. Mee requests kosam "request status" ani adagandi.'
                    }),
                    chips: ['Request status']
                };
            }
            const [leaves, wfh, regs] = await Promise.all([
                query(`SELECT COUNT(*)::int AS n FROM leave_applications WHERE status = 'pending'`),
                query(`SELECT COUNT(*)::int AS n FROM wfh_requests WHERE status = 'pending'`),
                runSafe(() => query(`SELECT COUNT(*)::int AS n FROM attendance_regularizations WHERE status = 'pending'`))
            ]);
            const total = (leaves.rows[0]?.n || 0) + (wfh.rows[0]?.n || 0) + (regs.rows[0]?.n || 0);
            let reply = pick('tg', { en: 'Pending approvals:\n', tg: 'Pending approvals:\n' });
            reply += `\u2022 Leaves: ${leaves.rows[0]?.n || 0}\n\u2022 WFH: ${wfh.rows[0]?.n || 0}\n\u2022 Regularizations: ${regs.rows[0]?.n || 0}`;
            if (total === 0) reply += pick('tg', { en: '\nAll clear! \ud83c\udf89', tg: '\nAnni clear! \ud83c\udf89' });
            return {
                reply,
                actions: [{ label: 'Review Requests', url: '/pages/manager/my-team.html' }]
            };
        }
    }
];


// --------------------------------------------------------------- matching

function pickIntent(text) {
    let best = null;
    let bestScore = 0;
    for (const intent of INTENTS) {
        const kwScore = intent.keywords && intent.keywords.length ? hitsAny(text, intent.keywords) : 0;

        // Small talk matches through dedicated patterns, not keyword lists.
        if (intent.name === 'smalltalk') {
            const casualScore =
                (/^\s*(hi+|hello+|hey|namaste|hlo|good\s*(morning|afternoon|evening))\b/.test(text) ? 3 : 0) +
                (/how\s*are\s*(you|u)/.test(text) ? 2 : 0) +
                (/what\s*(are|r)\s*(you|u)\s*(doing|do)|wt\s*(r|are)\s*(u|you)\s*doing/.test(text) ? 2 : 0) +
                (/had\s*lunch|lunch\s*a(yya|yyav)/.test(text) ? 2 : 0) +
                (/who\s*are\s*(you|u)/.test(text) ? 2 : 0) +
                (/\bthank/.test(text) ? 2 : 0) +
                (/\b(bye|good\s*night)\b/.test(text) ? 2 : 0);
            if (casualScore > bestScore) {
                bestScore = casualScore;
                best = intent;
            }
            continue;
        }

        const score = kwScore + (intent.priority || 0) / 1000;
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
            return res.json({ success: true, reply: pick(detectLang(raw), { en: 'What would you like to ask?', tg: 'Em adagaliru? Type cheyyandi.' }), chips: ['Help'] });
        }

        const lang = detectLang(text);

        const intent = pickIntent(text);
        if (!intent) {
            return res.json({
                success: true,
                reply: pick(lang, {
                    en: "Sorry, I didn't get that 🤔 Here's what I can do:",
                    tg: 'Sorry, adi ardham kaledu 🤔 Nenu ee vishayallo help chestanu:'
                }),
                chips: ['Leave balance', 'My attendance', 'Next holidays', 'Payslip', 'Request status', 'Help']
            });
        }

        const data = await intent.handler(req, text, lang);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('Assistant error:', error.message);
        res.status(500).json({ success: false, message: 'Assistant failed. Try again.' });
    }
});

module.exports = router;
