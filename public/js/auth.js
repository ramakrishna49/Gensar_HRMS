const API_URL = '/api';

function getLoginUrl(user) {
    if (user && (user.role === 'admin' || user.role === 'hr')) return '/admin/';
    return '/';
}

// Check if user is already logged in
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const path = window.location.pathname;
    const onLoginPage = path.includes('login.html') || path === '/' || path === '' || path.startsWith('/admin');
    if (token && onLoginPage) {
        const user = getCurrentUser();
        if (user && (user.role === 'admin' || user.role === 'hr')) {
            window.location.href = '/pages/admin/dashboard.html';
        } else if (user) {
            window.location.href = '/pages/employee/dashboard.html';
        }
    }
});

// Toggle password visibility
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        eyeIcon.classList.remove('fa-eye');
        eyeIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        eyeIcon.classList.remove('fa-eye-slash');
        eyeIcon.classList.add('fa-eye');
    }
}

// Handle Login
async function handleLogin(event, portal) {
    event.preventDefault();
    
    const employee_id = document.getElementById('employeeId').value.trim();
    const password = document.getElementById('password').value;
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    if (!employee_id || !password) {
        showToast('Please enter Employee ID and password', 'error');
        return;
    }
    
    const originalContent = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employee_id, password, portal: portal || 'employee' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Success!';
            submitBtn.style.background = 'var(--success)';
            
            showToast('Login successful! Redirecting...', 'success');
            
            setTimeout(() => {
                if (data.must_change_password) {
                    window.location.href = data.user.role === 'admin' || data.user.role === 'hr' ? '/pages/admin/settings.html' : '/pages/employee/profile.html';
                } else if (data.user.role === 'admin' || data.user.role === 'hr') {
                    window.location.href = '/pages/admin/dashboard.html';
                } else {
                    window.location.href = '/pages/employee/dashboard.html';
                }
            }, 800);
        } else {
            showToast(data.message || 'Invalid credentials', 'error');
            submitBtn.innerHTML = originalContent;
            submitBtn.disabled = false;
            submitBtn.style.background = '';
            
            const passwordField = document.getElementById('password');
            passwordField.style.borderColor = 'var(--danger)';
            setTimeout(() => { passwordField.style.borderColor = ''; }, 2000);
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Network error. Please try again.', 'error');
        submitBtn.innerHTML = originalContent;
        submitBtn.disabled = false;
        submitBtn.style.background = '';
    }
}

// Toast notification
function showToast(message, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas fa-${icons[type] || 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// API helper function
async function apiCall(endpoint, method = 'GET', body = null) {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(`${API_URL}${endpoint}`, options);
        
        if (response.status === 401) {
            const user = getCurrentUser();
            const loginUrl = getLoginUrl(user);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = loginUrl;
            return null;
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showToast('Network error. Please try again.', 'error');
        return null;
    }
}

// Logout function
function logout() {
    const user = getCurrentUser();
    const loginUrl = getLoginUrl(user);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = loginUrl;
}

// Download a file (e.g. PDF) with the auth token attached
async function downloadWithAuth(endpoint, filename) {
    const token = localStorage.getItem('token');
    if (!token) { window.location.href = getLoginUrl(getCurrentUser()); return; }
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401) {
            const user = getCurrentUser();
            const loginUrl = getLoginUrl(user);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = loginUrl;
            return;
        }
        if (!response.ok) {
            showToast('Failed to download file', 'error');
            return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'download.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        showToast('Network error while downloading', 'error');
    }
}

// Download a payslip PDF by payslip id
function downloadPayslipPdf(id) {
    const payload = String(id).split('|');
    const payslipId = payload[0];
    const name = payload[1] || 'payslip';
    downloadWithAuth(`/payroll/${payslipId}/pdf`, `payslip_${name}_${payslipId}.pdf`);
}

// Get current user
function getCurrentUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
}

// Check authentication
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = getLoginUrl(getCurrentUser());
        return false;
    }
    return true;
}

// Get initials from name
function getInitials(firstName, lastName) {
    return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase();
}

// Format currency
function formatCurrency(amount) {
    return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

// Format date
function formatDate(dateString, options = {}) {
    const defaults = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-IN', { ...defaults, ...options });
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load saved theme
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
});
