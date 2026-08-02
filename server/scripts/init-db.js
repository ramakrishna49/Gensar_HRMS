const path = require('path');
const { sqlite } = require('../config/database');
const bcrypt = require('bcryptjs');

function initDatabase() {
    console.log('Initializing SQLite database...');
    
    // Drop existing tables
    sqlite.exec(`
        DROP TABLE IF EXISTS password_reset_otps;
        DROP TABLE IF EXISTS documents;
        DROP TABLE IF EXISTS payroll;
        DROP TABLE IF EXISTS announcements;
        DROP TABLE IF EXISTS holidays;
        DROP TABLE IF EXISTS leave_applications;
        DROP TABLE IF EXISTS leave_types;
        DROP TABLE IF EXISTS attendance;
        DROP TABLE IF EXISTS employees;
        DROP TABLE IF EXISTS designations;
        DROP TABLE IF EXISTS departments;
        DROP TABLE IF EXISTS company_settings;
        DROP TABLE IF EXISTS companies;
    `);

    // Create tables
    sqlite.exec(`
        CREATE TABLE companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            logo TEXT,
            address TEXT,
            phone TEXT,
            email TEXT,
            website TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE designations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            level INTEGER DEFAULT 1,
            department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id TEXT UNIQUE NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password_hash TEXT NOT NULL,
            department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
            designation_id INTEGER REFERENCES designations(id) ON DELETE SET NULL,
            joining_date TEXT NOT NULL,
            salary REAL,
            profile_photo TEXT,
            role TEXT DEFAULT 'employee' CHECK (role IN ('admin', 'hr', 'manager', 'employee')),
            status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'terminated')),
            address TEXT,
            date_of_birth TEXT,
            gender TEXT,
            blood_group TEXT,
            emergency_contact TEXT,
            emergency_contact_name TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            check_in TEXT,
            check_out TEXT,
            status TEXT DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half-day', 'late', 'holiday', 'weekoff')),
            overtime_hours REAL DEFAULT 0,
            remarks TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(employee_id, date)
        );

        CREATE TABLE leave_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            days_per_year INTEGER NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE leave_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            total_days INTEGER NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
            approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            approval_remarks TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE wfh_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            total_days INTEGER NOT NULL,
            reason TEXT,
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
            approved_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            approval_remarks TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE holidays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            date TEXT NOT NULL,
            description TEXT,
            company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            category TEXT NOT NULL,
            subject TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
            status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
            admin_response TEXT,
            responded_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            responded_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
            posted_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            target_audience TEXT DEFAULT 'all' CHECK (target_audience IN ('all', 'admin', 'hr', 'manager', 'employee')),
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE payroll (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
            year INTEGER NOT NULL,
            basic_salary REAL,
            allowances REAL DEFAULT 0,
            deductions REAL DEFAULT 0,
            net_salary REAL,
            status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'paid')),
            payment_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(employee_id, month, year)
        );

        CREATE TABLE documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            file_url TEXT,
            file_name TEXT,
            document_type TEXT,
            uploaded_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE password_reset_otps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            otp TEXT NOT NULL,
            reset_token TEXT,
            is_used INTEGER DEFAULT 0,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE company_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT UNIQUE NOT NULL,
            setting_value TEXT,
            description TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
        CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
        CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);
        CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
        CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
        CREATE INDEX IF NOT EXISTS idx_leave_applications_employee ON leave_applications(employee_id);
        CREATE INDEX IF NOT EXISTS idx_leave_applications_status ON leave_applications(status);
        CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_month_year ON payroll(month, year);
        CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
        CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
        CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
    `);

    // Seed data
    const adminHash = bcrypt.hashSync('admin123', 10);
    const empHash = bcrypt.hashSync('welcome123', 10);

    // Default Company
    sqlite.prepare('INSERT INTO companies (name, email, phone) VALUES (?, ?, ?)').run('Gensar IT Solutions', 'info@gensar.com', '+91-9876543210');

    // Default Leave Types
    const insertLeaveType = sqlite.prepare('INSERT INTO leave_types (name, days_per_year, description) VALUES (?, ?, ?)');
    insertLeaveType.run('Casual Leave', 12, 'For personal work or casual reasons');
    insertLeaveType.run('Sick Leave', 12, 'For medical reasons or health issues');
    insertLeaveType.run('Earned Leave', 15, 'Earned leave for vacation or personal time');
    insertLeaveType.run('Maternity Leave', 180, 'For female employees during pregnancy');
    insertLeaveType.run('Paternity Leave', 15, 'For male employees after childbirth');
    insertLeaveType.run('Unpaid Leave', 0, 'Leave without pay');

    // Default Company Settings
    const insertSetting = sqlite.prepare('INSERT OR REPLACE INTO company_settings (setting_key, setting_value, description) VALUES (?, ?, ?)');
    insertSetting.run('company_name', 'Gensar IT Solutions', 'Company name');
    insertSetting.run('office_start_time', '09:30', 'Office start time');
    insertSetting.run('office_end_time', '18:30', 'Office end time');
    insertSetting.run('late_grace_period', '15', 'Grace period in minutes');
    insertSetting.run('currency', 'INR', 'Default currency');
    insertSetting.run('timezone', 'Asia/Kolkata', 'Default timezone');

    // Default Departments
    const insertDept = sqlite.prepare('INSERT INTO departments (name, description) VALUES (?, ?)');
    insertDept.run('Engineering', 'Software development and technical teams');
    insertDept.run('Human Resources', 'HR and people operations');
    insertDept.run('Marketing', 'Marketing and brand management');
    insertDept.run('Finance', 'Finance and accounting');
    insertDept.run('Operations', 'Business operations');

    // Default Designations
    const insertDesig = sqlite.prepare('INSERT INTO designations (name, level, department_id) VALUES (?, ?, ?)');
    insertDesig.run('Software Engineer', 1, 1);
    insertDesig.run('Senior Software Engineer', 2, 1);
    insertDesig.run('Tech Lead', 3, 1);
    insertDesig.run('HR Manager', 2, 2);
    insertDesig.run('HR Executive', 1, 2);
    insertDesig.run('Marketing Manager', 2, 3);
    insertDesig.run('Accountant', 1, 4);

    // Admin User
    sqlite.prepare(`INSERT INTO employees (employee_id, first_name, last_name, email, phone, password_hash, joining_date, salary, role, status, department_id, designation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'EMP001', 'Admin', 'User', 'admin@gensar.com', '+91-9876543210', adminHash, '2026-01-01', 50000, 'admin', 'active', 2, 4
    );

    // Demo Employees
    const insertEmp = sqlite.prepare(`INSERT INTO employees (employee_id, first_name, last_name, email, phone, password_hash, joining_date, salary, role, status, department_id, designation_id, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertEmp.run('EMP002', 'Rahul', 'Sharma', 'rahul@gensar.com', '+91-9876543211', empHash, '2026-02-01', 45000, 'employee', 'active', 1, 1, 'male');
    insertEmp.run('EMP003', 'Priya', 'Patel', 'priya@gensar.com', '+91-9876543212', empHash, '2026-02-15', 50000, 'employee', 'active', 1, 2, 'female');
    insertEmp.run('EMP004', 'Amit', 'Kumar', 'amit@gensar.com', '+91-9876543213', empHash, '2026-03-01', 60000, 'manager', 'active', 1, 3, 'male');
    insertEmp.run('EMP005', 'Sneha', 'Reddy', 'sneha@gensar.com', '+91-9876543214', empHash, '2026-03-15', 40000, 'employee', 'active', 3, 6, 'female');
    insertEmp.run('EMP006', 'Vikram', 'Singh', 'vikram@gensar.com', '+91-9876543215', empHash, '2026-04-01', 35000, 'employee', 'active', 4, 7, 'male');

    // Default Holidays (2026)
    const insertHoliday = sqlite.prepare('INSERT INTO holidays (name, date, description) VALUES (?, ?, ?)');
    insertHoliday.run('Republic Day', '2026-01-26', 'National holiday');
    insertHoliday.run('Holi', '2026-03-10', 'Festival of colors');
    insertHoliday.run('Independence Day', '2026-08-15', 'National holiday');
    insertHoliday.run('Gandhi Jayanti', '2026-10-02', 'National holiday');
    insertHoliday.run('Diwali', '2026-10-20', 'Festival of lights');
    insertHoliday.run('Christmas', '2026-12-25', 'Christmas Day');

    // Default Announcements
    const insertAnnouncement = sqlite.prepare('INSERT INTO announcements (title, content, priority, posted_by, target_audience) VALUES (?, ?, ?, ?, ?)');
    insertAnnouncement.run('Welcome to Gensar HRMS', 'We are excited to announce the launch of our new Human Resource Management System. Please explore the features and provide your feedback.', 'high', 1, 'all');
    insertAnnouncement.run('Office Timings Update', 'Effective immediately, office timings are 9:30 AM to 6:30 PM with a 15-minute grace period.', 'normal', 1, 'all');
    insertAnnouncement.run('Team Building Event', 'Join us for a team building event this Friday at 4:00 PM in the conference room.', 'low', 1, 'all');

    // Sample Attendance (today)
    const today = new Date().toISOString().split('T')[0];
    const insertAttendance = sqlite.prepare('INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, status, overtime_hours) VALUES (?, ?, ?, ?, ?, ?)');
    insertAttendance.run(1, today, '09:25', '18:35', 'present', 0.08);
    insertAttendance.run(2, today, '09:30', '18:45', 'present', 0.25);
    insertAttendance.run(3, today, '09:15', null, 'present', 0);
    insertAttendance.run(4, today, '09:20', '19:00', 'present', 0.5);
    insertAttendance.run(5, today, '09:40', '18:30', 'late', 0);

    console.log('Database initialized successfully!');
    console.log('');
    console.log('Default Admin Login:');
    console.log('  Email: admin@gensar.com');
    console.log('  Password: admin123');
    console.log('');
    console.log('Demo Employee Logins:');
    console.log('  Email: rahul@gensar.com / Password: welcome123');
    console.log('  Email: priya@gensar.com / Password: welcome123');
    console.log('  Email: amit@gensar.com / Password: welcome123');
    console.log('');
    console.log('Database location: data/gensar_hrms.db');
}

initDatabase();
sqlite.close();
