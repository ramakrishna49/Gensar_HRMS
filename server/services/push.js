const webpush = require('web-push');
const { query } = require('../config/database');

function isConfigured() {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

function ensureInit() {
    if (!isConfigured()) return false;
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    return true;
}

// Send a notification payload to one employee across all of their registered devices.
// Returns { sent, failed }. Failures never throw so request handlers stay unaffected.
async function sendToUser(userId, payload) {
    if (!ensureInit() || !userId) return { sent: 0, failed: 0 };

    let subscriptions = [];
    try {
        const result = await query(
            'SELECT id, subscription FROM push_subscriptions WHERE employee_id = $1',
            [userId]
        );
        subscriptions = result.rows;
    } catch (e) {
        console.error('Push lookup error:', e.message);
        return { sent: 0, failed: 0 };
    }

    let sent = 0, failed = 0;
    for (const row of subscriptions) {
        try {
            let sub = row.subscription;
            if (typeof sub === 'string') sub = JSON.parse(sub);
            await webpush.sendNotification(sub, JSON.stringify(payload));
            sent++;
        } catch (e) {
            failed++;
            // 404/410 = subscription expired or removed; clean it up.
            if (e.statusCode === 404 || e.statusCode === 410) {
                await query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
            }
        }
    }
    return { sent, failed };
}

// Send to a set of employee ids (used for batches e.g. announcements).
async function sendToUsers(userIds, payload) {
    let sent = 0, failed = 0;
    for (const userId of userIds) {
        const r = await sendToUser(userId, payload);
        sent += r.sent;
        failed += r.failed;
    }
    return { sent, failed };
}

// Send to all active employees, optionally filtered by role ('all' sends to everyone).
async function sendToAudience(role, payload) {
    if (!isConfigured()) return { sent: 0, failed: 0 };
    let clause = "WHERE e.status = 'active'";
    const params = [];
    if (role && role !== 'all') {
        clause += ' AND e.role = $1';
        params.push(role);
    }
    const result = await query(
        `SELECT e.id FROM employees e ${clause}`,
        params
    );
    return sendToUsers(result.rows.map((r) => r.id), payload);
}

module.exports = { sendToUser, sendToUsers, sendToAudience, isConfigured };
