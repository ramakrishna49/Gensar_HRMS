// Fire-and-forget audit logging. Never throws - a failed audit write must not
// break the business operation it is recording.
const { query } = require('../config/database');

// @param {Object} entry
// @param {number|null} entry.actorId   Employee performing the action (null for anonymous, e.g. failed login)
// @param {string} entry.action         e.g. 'employee.create', 'auth.login_failed'
// @param {string} [entry.entityType]   e.g. 'employee', 'document', 'payslip'
// @param {string|number} [entry.entityId]
// @param {Object} [entry.details]      Arbitrary JSON-serialisable context
// @param {string} [entry.ip]           Request IP if available
function logAudit(entry) {
    const { actorId = null, action, entityType = null, entityId = null, details = {}, ip = null } = entry || {};
    if (!action) return;

    let detailsJson;
    try {
        detailsJson = JSON.stringify(details || {});
    } catch (_) {
        detailsJson = '{}';
    }

    query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [actorId, action, entityType, entityId === undefined ? null : String(entityId), detailsJson, ip]
    ).catch((error) => {
        console.error('Audit log write failed:', error.message);
    });
}

module.exports = { logAudit };
