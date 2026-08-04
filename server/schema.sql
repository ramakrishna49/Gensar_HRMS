-- ============================================
-- GENSAR HRMS - Supabase (PostgreSQL) Schema
-- Inspired by Keka HR
-- Run this in the Supabase SQL editor (or `npm run db:init`)
-- ============================================

-- 1. COMPANIES
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    logo VARCHAR(500),
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(255) UNIQUE,
    website VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. DEPARTMENTS
CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    company_id INT REFERENCES companies(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. DESIGNATIONS
CREATE TABLE IF NOT EXISTS designations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    level INT DEFAULT 1,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    department_id INT REFERENCES departments(id) ON DELETE SET NULL,
    designation_id INT REFERENCES designations(id) ON DELETE SET NULL,
    reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL,
    joining_date DATE NOT NULL,
    salary DECIMAL(10,2),
    profile_photo VARCHAR(500),
    role VARCHAR(20) DEFAULT 'employee' CHECK (role IN ('admin', 'hr', 'manager', 'team_lead', 'employee')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'paused', 'terminated')),
    address TEXT,
    date_of_birth DATE,
    gender VARCHAR(10),
    blood_group VARCHAR(5),
    emergency_contact VARCHAR(20),
    emergency_contact_name VARCHAR(100),
    must_change_password INTEGER DEFAULT 0,
    permanent_address TEXT,
    languages_spoken TEXT,
    marital_status TEXT,
    personal_email TEXT,
    qualification TEXT,
    specialization TEXT,
    pan_number TEXT,
    aadhaar_number TEXT,
    passport_number TEXT,
    bank_name TEXT,
    bank_branch TEXT,
    bank_account TEXT,
    bank_ifsc TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. ATTENDANCE
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in TIME,
    check_out TIME,
    break_start TIME,
    break_end TIME,
    break_log TEXT,
    status VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half-day', 'late', 'holiday', 'weekoff')),
    overtime_hours DECIMAL(4,2) DEFAULT 0,
    remarks TEXT,
    check_in_location TEXT,
    check_out_location TEXT,
    photo_token TEXT,
    photo_token_checkout TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, date)
);

-- 6. LEAVE TYPES
CREATE TABLE IF NOT EXISTS leave_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    days_per_year INT NOT NULL,
    description TEXT,
    gender_eligibility VARCHAR(10) DEFAULT 'all' CHECK (gender_eligibility IN ('all', 'male', 'female')),
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 7. LEAVE APPLICATIONS
CREATE TABLE IF NOT EXISTS leave_applications (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id INT REFERENCES leave_types(id) ON DELETE SET NULL,
    reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INT NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by INT REFERENCES employees(id) ON DELETE SET NULL,
    approval_remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 8. WFH REQUESTS
CREATE TABLE IF NOT EXISTS wfh_requests (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INT NOT NULL,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_by INT REFERENCES employees(id) ON DELETE SET NULL,
    approval_remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 9. HOLIDAYS
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    company_id INT REFERENCES companies(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(name, date)
);

-- 10. SUPPORT TICKETS
CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    admin_response TEXT,
    responded_by INT REFERENCES employees(id) ON DELETE SET NULL,
    responded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 11. ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    posted_by INT REFERENCES employees(id) ON DELETE SET NULL,
    target_audience VARCHAR(50) DEFAULT 'all' CHECK (target_audience IN ('all', 'admin', 'hr', 'manager', 'employee')),
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 12. ANNOUNCEMENT READS
CREATE TABLE IF NOT EXISTS announcement_reads (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    announcement_id INT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, announcement_id)
);

-- 13. PAYROLL
CREATE TABLE IF NOT EXISTS payroll (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INT NOT NULL,
    basic_salary DECIMAL(10,2),
    allowances DECIMAL(10,2) DEFAULT 0,
    deductions DECIMAL(10,2) DEFAULT 0,
    net_salary DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'paid')),
    payment_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, month, year)
);

-- 14. DOCUMENTS
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    file_url VARCHAR(500),
    file_name VARCHAR(500),
    document_type VARCHAR(100),
    uploaded_by INT REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 15. PASSWORD RESET OTPS
CREATE TABLE IF NOT EXISTS password_reset_otps (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    otp TEXT NOT NULL,
    reset_token TEXT,
    is_used INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 16. COMPANY SETTINGS
CREATE TABLE IF NOT EXISTS company_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 17. ATTENDANCE PHOTOS (one-time view)
CREATE TABLE IF NOT EXISTS attendance_photos (
    id SERIAL PRIMARY KEY,
    attendance_id INT NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    photo BYTEA NOT NULL,
    token TEXT NOT NULL UNIQUE,
    viewed INTEGER DEFAULT 0,
    viewed_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    type VARCHAR(20) DEFAULT 'check_in' CHECK (type IN ('check_in', 'check_out')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 18. PROFILE UPDATE REQUESTS
CREATE TABLE IF NOT EXISTS profile_update_requests (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by INT REFERENCES employees(id) ON DELETE SET NULL,
    review_remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 19. PUSH SUBSCRIPTIONS (PWA web-push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    subscription JSONB NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee ON leave_applications(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_applications_status ON leave_applications(status);
CREATE INDEX IF NOT EXISTS idx_wfh_requests_employee ON wfh_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_month_year ON payroll(month, year);
CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_attendance_photos_token ON attendance_photos(token);
CREATE INDEX IF NOT EXISTS idx_attendance_photos_expires ON attendance_photos(expires_at);
CREATE INDEX IF NOT EXISTS idx_profile_requests_employee ON profile_update_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_profile_requests_status ON profile_update_requests(status);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_employee ON announcement_reads(employee_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_employee ON push_subscriptions(employee_id);

-- ============================================
-- SEED DATA
-- ============================================

INSERT INTO companies (name, email, phone) VALUES ('Gensar IT Solutions', 'info@gensar.com', '+91-9876543210')
ON CONFLICT (email) DO NOTHING;

INSERT INTO leave_types (name, days_per_year, description, gender_eligibility) VALUES
('Casual Leave', 12, 'For personal work or casual reasons', 'all'),
('Sick Leave', 12, 'For medical reasons or health issues', 'all'),
('Maternity Leave', 0, 'Special leave for female employees during pregnancy (no balance deduction)', 'female'),
('Paternity Leave', 0, 'For male employees after childbirth', 'male'),
('Unpaid Leave', 0, 'Leave without pay', 'all')
ON CONFLICT (name) DO NOTHING;

INSERT INTO company_settings (setting_key, setting_value, description) VALUES
('company_name', 'Gensar IT Solutions', 'Company name'),
('office_start_time', '09:30', 'Office start time'),
('office_end_time', '18:30', 'Office end time'),
('late_grace_period', '15', 'Grace period in minutes'),
('currency', 'INR', 'Default currency'),
('timezone', 'Asia/Kolkata', 'Default timezone')
ON CONFLICT (setting_key) DO NOTHING;

INSERT INTO departments (name, description) VALUES
('Engineering', 'Software development and technical teams'),
('Human Resources', 'HR and people operations'),
('Marketing', 'Marketing and brand management'),
('Finance', 'Finance and accounting'),
('Operations', 'Business operations')
ON CONFLICT (name) DO NOTHING;

INSERT INTO designations (name, level, department_id) VALUES
('Software Engineer', 1, 1),
('Senior Software Engineer', 2, 1),
('Tech Lead', 3, 1),
('HR Manager', 2, 2),
('HR Executive', 1, 2),
('Marketing Manager', 2, 3),
('Accountant', 1, 4)
ON CONFLICT (name) DO NOTHING;

-- Admin (Password: admin123)
INSERT INTO employees (employee_id, first_name, last_name, email, phone, password_hash, joining_date, salary, role, status, department_id, designation_id, gender)
VALUES ('EMP001', 'Admin', 'User', 'admin@gensar.com', '+91-9876543210', '$2a$10$JBZsKgXIjT.0Jqqs7qkjK.VCVMcze7MWlJ1fVzk1cujkDAvJ20tYy', '2026-01-01', 50000, 'admin', 'active', 2, 4, NULL)
ON CONFLICT (email) DO NOTHING;

-- Demo Employees (Password: welcome123)
INSERT INTO employees (employee_id, first_name, last_name, email, phone, password_hash, joining_date, salary, role, status, department_id, designation_id, gender) VALUES
('EMP002', 'Rahul', 'Sharma', 'rahul@gensar.com', '+91-9876543211', '$2a$10$sks15taut7UBFroTzZ3zQegIjsAa4rnzWsbvfATLQPyw4y5QlP8vK', '2026-02-01', 45000, 'employee', 'active', 1, 1, 'male'),
('EMP003', 'Priya', 'Patel', 'priya@gensar.com', '+91-9876543212', '$2a$10$sks15taut7UBFroTzZ3zQegIjsAa4rnzWsbvfATLQPyw4y5QlP8vK', '2026-02-15', 50000, 'employee', 'active', 1, 2, 'female'),
('EMP004', 'Amit', 'Kumar', 'amit@gensar.com', '+91-9876543213', '$2a$10$sks15taut7UBFroTzZ3zQegIjsAa4rnzWsbvfATLQPyw4y5QlP8vK', '2026-03-01', 60000, 'manager', 'active', 1, 3, 'male'),
('EMP005', 'Sneha', 'Reddy', 'sneha@gensar.com', '+91-9876543214', '$2a$10$sks15taut7UBFroTzZ3zQegIjsAa4rnzWsbvfATLQPyw4y5QlP8vK', '2026-03-15', 40000, 'employee', 'active', 3, 6, 'female'),
('EMP006', 'Vikram', 'Singh', 'vikram@gensar.com', '+91-9876543215', '$2a$10$sks15taut7UBFroTzZ3zQegIjsAa4rnzWsbvfATLQPyw4y5QlP8vK', '2026-04-01', 35000, 'employee', 'active', 4, 7, 'male')
ON CONFLICT (email) DO NOTHING;

INSERT INTO holidays (name, date, description) VALUES
('Republic Day', '2026-01-26', 'National holiday'),
('Holi', '2026-03-10', 'Festival of colors'),
('Independence Day', '2026-08-15', 'National holiday'),
('Gandhi Jayanti', '2026-10-02', 'National holiday'),
('Diwali', '2026-10-20', 'Festival of lights'),
('Christmas', '2026-12-25', 'Christmas Day')
ON CONFLICT (name, date) DO NOTHING;

INSERT INTO announcements (title, content, priority, posted_by, target_audience)
SELECT * FROM (VALUES
    ('Welcome to Gensar HRMS', 'We are excited to announce the launch of our new Human Resource Management System. Please explore the features and provide your feedback.', 'high', 1, 'all'),
    ('Office Timings Update', 'Effective immediately, office timings are 9:30 AM to 6:30 PM with a 15-minute grace period.', 'normal', 1, 'all'),
    ('Team Building Event', 'Join us for a team building event this Friday at 4:00 PM in the conference room.', 'low', 1, 'all')
) AS v(title, content, priority, posted_by, target_audience)
WHERE NOT EXISTS (SELECT 1 FROM announcements);

-- ============================================
-- MIGRATIONS (idempotent - safe to re-run)
-- ============================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE leave_applications ADD COLUMN IF NOT EXISTS reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE wfh_requests ADD COLUMN IF NOT EXISTS reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reporting_manager_id INT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE designations ADD COLUMN IF NOT EXISTS team_lead_id INT REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_reporting_manager ON employees(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_leave_rm ON leave_applications(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_wfh_rm ON wfh_requests(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_tickets_rm ON support_tickets(reporting_manager_id);

-- Maternity Leave is a special leave: 0 days balance, no deduction, still approvable.
UPDATE leave_types SET days_per_year = 0 WHERE name = 'Maternity Leave';

-- Paternity Leave: 0 days balance, no deduction, still approvable (like Maternity).
UPDATE leave_types SET days_per_year = 0 WHERE name = 'Paternity Leave';

-- Earned Leave removed from new requests (soft-disable) - history is preserved.
UPDATE leave_types SET is_active = 0 WHERE name = 'Earned Leave';

-- Add team_lead role (idempotent: drop + recreate the role check constraint).
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE employees ADD CONSTRAINT employees_role_check CHECK (role IN ('admin', 'hr', 'manager', 'team_lead', 'employee'));

-- ============================================
-- PAYROLL MODULE MIGRATIONS (idempotent)
-- ============================================

-- Employee master: statutory / compliance identifiers shown on the payslip.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uan_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pf_number TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS esi_number TEXT;

-- Payroll: attendance summary for the pay period.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS working_days INT DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS present_days INT DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS leave_days INT DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS lop_days INT DEFAULT 0;

-- Payroll: granular earnings (kept separate from the legacy `allowances` column).
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS hra DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS conveyance DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS medical DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS special_allowance DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS bonus DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS incentive DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS other_allowance DECIMAL(10,2) DEFAULT 0;

-- Payroll: employee deductions (kept separate from the legacy `deductions` column).
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS pf DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS esi DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS professional_tax DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS income_tax DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS loan_deduction DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS advance_salary DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS other_deduction DECIMAL(10,2) DEFAULT 0;

-- Payroll: employer contributions.
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS employer_pf DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS employer_esi DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS employer_contribution DECIMAL(10,2) DEFAULT 0;

-- Payroll: computed values (stored for fast reporting / history).
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS gross_salary DECIMAL(10,2) DEFAULT 0;
ALTER TABLE payroll ADD COLUMN IF NOT EXISTS total_deductions DECIMAL(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll(status);
