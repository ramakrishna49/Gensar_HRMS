// Dashboard JavaScript for Gensar HRMS

// Toggle sidebar
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    
    if (window.innerWidth <= 768) {
        sidebar.classList.toggle('active');
    } else {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
    }
}

// Toggle dark mode
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('themeIcon');
    
    if (document.body.classList.contains('dark-mode')) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
        localStorage.setItem('theme', 'dark');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
        localStorage.setItem('theme', 'light');
    }
}

// Toggle profile menu
function toggleProfileMenu() {
    const menu = document.getElementById('profileMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Notification dropdown panel (employees)
let notificationPanelEl = null;

function toggleNotificationPanel() {
    const bell = document.querySelector('.notification-btn[title="Notifications"]');
    if (!bell) return;
    const user = getCurrentUser();
    if (!user) return;

    if (notificationPanelEl && notificationPanelEl.parentElement === bell) {
        notificationPanelEl.remove();
        notificationPanelEl = null;
        return;
    }

    if (notificationPanelEl) notificationPanelEl.remove();

    notificationPanelEl = document.createElement('div');
    notificationPanelEl.className = 'notification-panel';
    notificationPanelEl.id = 'notificationPanel';
    notificationPanelEl.innerHTML = `
        <div class="notification-panel-header">
            <span><i class="fas fa-bell" style="margin-right:6px;"></i>Notifications</span>
            <button class="mark-all-btn" id="markAllReadBtn">Mark all as read</button>
        </div>
        <div class="notification-panel-list" id="notificationList" style="min-height:60px;">
            <div class="notification-panel-empty"><i class="fas fa-spinner fa-spin"></i>Loading...</div>
        </div>
        <div class="notification-panel-footer">
            <a href="/pages/employee/announcements.html">View all announcements</a>
        </div>
    `;

    bell.appendChild(notificationPanelEl);
    loadNotificationList();

    const markAllBtn = document.getElementById('markAllReadBtn');
    markAllBtn.onclick = async function(e) {
        e.preventDefault();
        e.stopPropagation();
        await apiCall('/announcements/read-all', 'POST');
        loadNotifBadge();
        loadNotificationList();
    };
}

async function loadNotificationList() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    try {
        const data = await apiCall('/announcements');
        if (!data || !data.success) {
            list.innerHTML = '<div class="notification-panel-empty"><i class="fas fa-exclamation-circle"></i>Failed to load</div>';
            return;
        }
        const announcements = (data.announcements || []).slice(0, 8);
        if (announcements.length === 0) {
            list.innerHTML = '<div class="notification-panel-empty"><i class="fas fa-bell-slash"></i>No announcements yet</div>';
            return;
        }
        list.innerHTML = announcements.map(a => {
            const unreadClass = a.is_read ? 'is-read' : '';
            const prio = a.priority || 'normal';
            const prioColor = getPriorityColor(prio);
            const time = formatTimeAgo(a.created_at);
            return `
                <a href="javascript:void(0)" class="notification-item ${unreadClass}" data-id="${a.id}">
                    <span class="notif-dot"></span>
                    <div class="notif-body">
                        <div class="notif-title">${escapeHtml(a.title)}</div>
                        <div class="notif-meta">
                            <span class="priority-tag" style="background:${prioColor}22;color:${prioColor};">${prio.toUpperCase()}</span>
                            <span>${time}</span>
                        </div>
                    </div>
                </a>
            `;
        }).join('');

        list.querySelectorAll('.notification-item').forEach(item => {
            item.addEventListener('click', async () => {
                const id = item.getAttribute('data-id');
                if (!item.classList.contains('is-read')) {
                    await apiCall('/announcements/' + id + '/read', 'POST');
                    loadNotifBadge();
                }
                window.location.href = '/pages/employee/announcements.html';
            });
        });
    } catch (e) {
        list.innerHTML = '<div class="notification-panel-empty"><i class="fas fa-exclamation-circle"></i>Failed to load</div>';
    }
}

function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr.replace(' ', 'T') + 'Z');
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return formatDate(dateStr);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatHours(h) {
    const val = parseFloat(h) || 0;
    if (val === 0) return '0h';
    let rounded = Math.round(val * 100) / 100;
    if (rounded === Math.floor(rounded)) {
        return rounded + 'h';
    }
    return rounded.toFixed(2).replace(/\.?0+$/, '') + 'h';
}

// Load user info into sidebar/profile
function loadUserInfo() {
    const user = getCurrentUser();
    if (!user) return;
    
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const profileNameEl = document.getElementById('profileName');
    const profilePhotoEls = document.querySelectorAll('.profile-photo');
    
    const fullName = `${user.first_name} ${user.last_name}`;
    if (userNameEl) userNameEl.textContent = fullName;
    if (userRoleEl) userRoleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    if (profileNameEl) profileNameEl.textContent = fullName;
    
    const initials = ((user.first_name || '')[0] || '') + ((user.last_name || '')[0] || '');
    profilePhotoEls.forEach(el => {
        if (user.profile_photo) {
            el.innerHTML = '<img src="' + user.profile_photo + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Profile">';
        } else {
            el.textContent = initials.toUpperCase();
        }
    });

    loadNotifBadge();
    loadSidebarLogo();
}

async function loadNotifBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const user = getCurrentUser();
    if (!user) return;
    try {
        let count = 0;
        if (user.role === 'admin') {
            const data = await apiCall('/notifications/counts');
            if (data && data.success) {
                count = data.counts.pendingLeaves + data.counts.pendingProfileUpdates + data.counts.announcementsUnread;
            }
        } else {
            const data = await apiCall('/announcements/unread-count');
            if (data && data.success) {
                count = parseInt(data.count) || 0;
            }
        }
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    } catch (e) {
        badge.style.display = 'none';
    }
}

// Load sidebar logo
function loadSidebarLogo() {
    const logoEls = document.querySelectorAll('.sidebar-logo');
    logoEls.forEach(el => {
        el.innerHTML = '<i class="fas fa-building" style="color:var(--primary-light);font-size:1.5rem;"></i><span style="font-size:1rem;font-weight:700;">Gensar HRMS</span>';
    });
}

// Show confirm dialog (replaces browser confirm)
function showConfirmDialog(title, message, confirmText, confirmBtnClass, onConfirm) {
    const existing = document.getElementById('confirmDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDialogOverlay';
    overlay.className = 'modal active';
    overlay.onclick = function(e) { if (e.target === this) { this.remove(); } };

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.maxWidth = '420px';
    content.onclick = function(e) { e.stopPropagation(); };

    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<h2><i class="fas fa-exclamation-triangle" style="color:var(--warning);margin-right:8px;"></i>' + title + '</h2><button class="modal-close" onclick="this.closest(\'.modal\').remove()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);">&times;</button>';

    const body = document.createElement('div');
    body.className = 'modal-body';
    body.innerHTML = '<p style="line-height:1.6;">' + message + '</p>';

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = '<button class="btn btn-secondary" onclick="this.closest(\'.modal\').remove()">Cancel</button>';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn ' + (confirmBtnClass || 'btn-danger');
    confirmBtn.innerHTML = '<i class="fas fa-check"></i> ' + (confirmText || 'Confirm');
    confirmBtn.onclick = function() {
        overlay.remove();
        if (typeof onConfirm === 'function') onConfirm();
    };

    footer.appendChild(confirmBtn);
    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
}

// Show skeleton loader
function showSkeleton(container, count = 3) {
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-card skeleton" style="margin-bottom: 12px;"></div>
        `;
    }
    container.innerHTML = html;
}

// Show empty state
function showEmptyState(container, icon, title, message) {
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas ${icon}"></i>
            <h3>${title}</h3>
            <p>${message}</p>
        </div>
    `;
}

// Helper functions
function getPriorityColor(priority) {
    const colors = {
        low: '#10B981',
        normal: '#4F46E5',
        high: '#F59E0B',
        urgent: '#EF4444'
    };
    return colors[priority] || colors.normal;
}

function getPriorityBadge(priority) {
    const badges = {
        low: 'success',
        normal: 'info',
        high: 'warning',
        urgent: 'danger'
    };
    return badges[priority] || 'info';
}

function getStatusBadge(status) {
    const badges = {
        active: 'success',
        inactive: 'secondary',
        paused: 'warning',
        terminated: 'danger',
        pending: 'warning',
        approved: 'success',
        rejected: 'danger',
        present: 'success',
        absent: 'danger',
        'half-day': 'warning',
        late: 'warning',
        paid: 'success',
        processed: 'info',
        draft: 'secondary',
        open: 'warning',
        in_progress: 'info',
        resolved: 'success',
        closed: 'secondary',
        low: 'secondary',
        medium: 'warning',
        high: 'danger'
    };
    return badges[status] || 'secondary';
}

function getStatusText(status) {
    const labels = {
        present: 'Present',
        absent: 'Absent',
        late: 'Late Login',
        'half-day': 'Half Day',
        pending: 'Pending',
        approved: 'Approved',
        rejected: 'Rejected',
        open: 'Open',
        in_progress: 'In Progress',
        resolved: 'Resolved',
        closed: 'Closed',
        low: 'Low',
        medium: 'Medium',
        high: 'High'
    };
    return labels[status] || status;
}

// Close profile menu when clicking outside
document.addEventListener('click', (e) => {
    const profileBtn = document.querySelector('.profile-btn');
    const profileMenu = document.getElementById('profileMenu');
    
    if (profileBtn && profileMenu && !profileBtn.contains(e.target) && !profileMenu.contains(e.target)) {
        profileMenu.style.display = 'none';
    }

    const bell = document.querySelector('.notification-btn[title="Notifications"]');
    const panel = document.getElementById('notificationPanel');
    if (bell && panel && !bell.contains(e.target)) {
        panel.remove();
        notificationPanelEl = null;
    }
});

// Close sidebar on mobile when clicking outside
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.querySelector('.menu-toggle');
    
    if (window.innerWidth <= 768 && sidebar && menuToggle) {
        if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    }
});

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    loadUserInfo();

    // Intercept bell click for employees to open notification popup
    const bell = document.querySelector('.notification-btn[title="Notifications"]');
    if (bell) {
        bell.addEventListener('click', (e) => {
            const user = getCurrentUser();
            if (user && user.role !== 'admin') {
                if (e.target.closest('#notificationPanel')) return;
                e.preventDefault();
                toggleNotificationPanel();
            }
        });
    }
    
    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('themeIcon');
        if (icon) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        }
    }
    
    // Handle responsive sidebar
    const handleResize = () => {
        const sidebar = document.getElementById('sidebar');
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('collapsed');
        }
    };
    
    window.addEventListener('resize', handleResize);
    handleResize();
});
