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

// Tables added in later releases. A live database that predates them fails with
// 42P01 ("relation does not exist"); the DDL below is fully idempotent and only
// ever creates what is missing - existing rows are never touched.
const ENSURE_TABLE_DDL = {
    audit_logs: [
        `CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            actor_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(50),
            entity_id TEXT,
            details JSONB DEFAULT '{}',
            ip_address VARCHAR(64),
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action)`
    ],
    attendance_regularizations: [
        `CREATE TABLE IF NOT EXISTS attendance_regularizations (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            check_in TIME,
            check_out TIME,
            reason TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            reviewed_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            review_note TEXT,
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (employee_id, date)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_att_reg_employee ON attendance_regularizations (employee_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_att_reg_status ON attendance_regularizations (status)`
    ],
    // Onboarding module release. Created lazily on the first 42P01 so no manual
    // db:migrate is required on the live database - purely additive DDL.
    hr_task_templates: [
        `CREATE TABLE IF NOT EXISTS hr_task_templates (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            assignee_role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (assignee_role IN ('admin', 'employee')),
            sequence INT DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_hr_task_templates_active ON hr_task_templates(is_active)`
    ],
    employee_processes: [
        `CREATE TABLE IF NOT EXISTS employee_processes (
            id SERIAL PRIMARY KEY,
            employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            type VARCHAR(20) NOT NULL DEFAULT 'onboarding' CHECK (type IN ('onboarding', 'offboarding')),
            status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
            started_by INT REFERENCES employees(id) ON DELETE SET NULL,
            started_at TIMESTAMP DEFAULT NOW(),
            completed_at TIMESTAMP,
            UNIQUE (employee_id, type)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_employee_processes_employee ON employee_processes(employee_id)`,
        `CREATE INDEX IF NOT EXISTS idx_employee_processes_status ON employee_processes(status)`
    ],
    process_tasks: [
        `CREATE TABLE IF NOT EXISTS process_tasks (
            id SERIAL PRIMARY KEY,
            process_id INT NOT NULL REFERENCES employee_processes(id) ON DELETE CASCADE,
            template_id INT REFERENCES hr_task_templates(id) ON DELETE SET NULL,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            assignee_role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (assignee_role IN ('admin', 'employee')),
            sequence INT DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
            remarks TEXT,
            completed_by INT REFERENCES employees(id) ON DELETE SET NULL,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_process_tasks_process ON process_tasks(process_id)`
    ],
    // Daily & Weekly Work Count module
    work_projects: [
        `CREATE TABLE IF NOT EXISTS work_projects (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            customer_name VARCHAR(255),
            weekly_target_per_employee DECIMAL(10,2) DEFAULT 0,
            working_days INT DEFAULT 6 CHECK (working_days BETWEEN 1 AND 7),
            status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_work_projects_status ON work_projects(status)`
    ],
    project_employees: [
        `CREATE TABLE IF NOT EXISTS project_employees (
            id SERIAL PRIMARY KEY,
            project_id INT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
            employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'removed')),
            assigned_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(project_id, employee_id)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_proj_emp_project ON project_employees(project_id)`,
        `CREATE INDEX IF NOT EXISTS idx_proj_emp_employee ON project_employees(employee_id)`,
        `CREATE INDEX IF NOT EXISTS idx_proj_emp_status ON project_employees(status)`
    ],
    daily_work_counts: [
        `CREATE TABLE IF NOT EXISTS daily_work_counts (
            id SERIAL PRIMARY KEY,
            project_id INT NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
            employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            work_date DATE NOT NULL,
            daily_count DECIMAL(10,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(project_id, employee_id, work_date)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_daily_count_project ON daily_work_counts(project_id)`,
        `CREATE INDEX IF NOT EXISTS idx_daily_count_employee ON daily_work_counts(employee_id)`,
        `CREATE INDEX IF NOT EXISTS idx_daily_count_date ON daily_work_counts(work_date)`,
        `CREATE INDEX IF NOT EXISTS idx_daily_count_lookup ON daily_work_counts(project_id, employee_id, work_date)`
    ],
    work_holidays: [
        `CREATE TABLE IF NOT EXISTS work_holidays (
            id SERIAL PRIMARY KEY,
            holiday_date DATE NOT NULL UNIQUE,
            holiday_name VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE INDEX IF NOT EXISTS idx_work_holidays_date ON work_holidays(holiday_date)`
    ]
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

function missingTableInfo(error) {
    if (!error || error.code !== '42P01') return null;
    const msg = String((error && error.message) || '');
    const m = /relation "([a-z0-9_]+)" does not exist/i.exec(msg);
    return (m && m[1]) || (error && error.table) || null;
}

async function ensureEmployeeColumn(column) {
    const ddl = EMPLOYEE_ALTER_COLUMNS[column];
    if (!ddl) return false;
    // The column name comes from the database error message, never from user input.
    await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "${column}" ${ddl}`);
    return true;
}

async function ensureTable(table) {
    const statements = ENSURE_TABLE_DDL[table];
    if (!statements) return false;
    for (const sql of statements) {
        await query(sql);
    }
    return true;
}

// Runs fn, and if it fails with a missing-column (42703) or missing-table
// (42P01) error, heals the schema and retries. Loops in case several things
// are missing (Postgres reports one at a time).
async function runWithSchemaRepair(fn) {
    const maxAttempts = Object.keys(EMPLOYEE_ALTER_COLUMNS).length + Object.keys(ENSURE_TABLE_DDL).length + 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt < maxAttempts - 1) {
                if (error && error.code === '42703') {
                    const miss = missingColumnInfo(error);
                    if (miss.column && await ensureEmployeeColumn(miss.column)) {
                        continue;
                    }
                } else {
                    const table = missingTableInfo(error);
                    if (table && await ensureTable(table)) {
                        continue;
                    }
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

module.exports = { runWithSchemaRepair, ensureEmployeeColumn, ensureTable, pgErrorResponse, missingColumnInfo };
