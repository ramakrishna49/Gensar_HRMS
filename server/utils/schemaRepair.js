const { query } = require('../config/database');

// Columns that may have been added to the employees table via ALTER TABLE after
// the production database was first initialized (server/scripts/init-db.js is
// manual-only and was probably last run before the payroll/salary-structure
// columns existed). If any of these are missing, INSERT/UPDATE statements that
// reference them fail with error 42703. The type map below drives an idempotent,
// additive self-heal that never touches existing data.
const EMPLOYEE_ALTER_COLUMNS = {
    basic_salary: 'DECIMAL(10,2) DEFAULT 0',
    hra: 'DECIMAL(10,2) DEFAULT 0',
    conveyance: 'DECIMAL(10,2) DEFAULT 0',
    medical: 'DECIMAL(10,2) DEFAULT 0',
    special_allowance: 'DECIMAL(10,2) DEFAULT 0',
    other_allowance: 'DECIMAL(10,2) DEFAULT 0',
    pf: 'DECIMAL(10,2) DEFAULT 0',
    esi: 'DECIMAL(10,2) DEFAULT 0',
    professional_tax: 'DECIMAL(10,2) DEFAULT 0',
    income_tax: 'DECIMAL(10,2) DEFAULT 0',
    loan_deduction: 'DECIMAL(10,2) DEFAULT 0',
    advance_salary: 'DECIMAL(10,2) DEFAULT 0',
    other_deduction: 'DECIMAL(10,2) DEFAULT 0',
    incentive: 'DECIMAL(10,2) DEFAULT 0',
    bonus: 'DECIMAL(10,2) DEFAULT 0',
    extra_work: 'DECIMAL(10,2) DEFAULT 0',
    employer_pf: 'DECIMAL(10,2) DEFAULT 0',
    employer_esi: 'DECIMAL(10,2) DEFAULT 0',
    employer_contribution: 'DECIMAL(10,2) DEFAULT 0',
    uan_number: 'TEXT',
    pf_number: 'TEXT',
    esi_number: 'TEXT',
    reporting_manager_id: 'INT REFERENCES employees(id) ON DELETE SET NULL',
    // Added by the session-revocation release; verifyToken selects it on every
    // request, so a missing column must be healed before anything else works.
    must_change_password: 'INTEGER DEFAULT 0',
    token_version: 'INTEGER NOT NULL DEFAULT 0'
};

function missingColumnInfo(error) {
    // Postgres reports 42703 either as `column "x" of relation "y" does not
    // exist` or simply `column "x" does not exist`. Accept both, and fall back
    // to the structured error fields when the driver exposes them.
    const msg = error && error.message ? String(error.message) : '';
    const m = /column "([a-z0-9_]+)"(?: of relation "([a-z0-9_]+)")? does not exist/i.exec(msg);
    const column = (m && m[1]) || (error && error.column) || null;
    const table = (m && m[2]) || (error && error.table) || null;
    return { column, table };
}

async function ensureEmployeeColumn(column) {
    const ddl = EMPLOYEE_ALTER_COLUMNS[column];
    if (!ddl) return false;
    // The column name comes from the database error message, never from user input.
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "${column}" ${ddl}`);
    return true;
}

// Runs fn, and if it fails with a missing-column error (42703) for the employees
// table, adds the missing column and retries. Loops in case several columns are
// missing (Postgres reports the first one at a time).
async function runWithSchemaRepair(fn) {
    const maxAttempts = Object.keys(EMPLOYEE_ALTER_COLUMNS).length + 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (error && error.code === '42703' && attempt < maxAttempts - 1) {
                const miss = missingColumnInfo(error);
                if (miss.column && await ensureEmployeeColumn(miss.column)) {
                    continue;
                }
            }
            throw error;
        }
    }
}

// Friendly message for common Postgres errors.
function pgErrorResponse(error) {
    if (error && error.code === '23505') {
        const constraint = error.constraint || '';
        if (constraint.includes('employee_id')) {
            return { status: 400, message: 'This Employee ID is already in use. Please choose a different one.' };
        }
        if (constraint.includes('email')) {
            return { status: 400, message: 'This email address is already in use by another employee.' };
        }
        return { status: 400, message: 'A record with this value already exists.' };
    }
    if (error && error.code === '23503') {
        return { status: 400, message: 'Invalid reference. Please select a valid department, designation or reporting person.' };
    }
    if (error && error.code === '22P02') {
        return { status: 400, message: 'Invalid number or value format. Please enter numbers only.' };
    }
    if (error && (error.code === '22007' || error.code === '22008')) {
        return { status: 400, message: 'Invalid date format.' };
    }
    if (error && error.code === '23514') {
        return { status: 400, message: 'One of the entered values is not allowed for this field.' };
    }
    return { status: 500, message: 'Server error' };
}

module.exports = { runWithSchemaRepair, ensureEmployeeColumn, pgErrorResponse, missingColumnInfo };
