// Gensar HRMS - Shared App Shell (Phase 1: layout deduplication)
// Single source of truth for sidebar + header.
// NO visual change: renders byte-identical markup to the old copy-pasted HTML.
// Pages opt-in via:
//   <body class="admin-app" data-page-title="Dashboard" data-active="/admin/dashboard">
//     <div id="app-shell"></div>
//     ... page-body content ...
// If #app-shell is absent, this file does nothing (old pages keep working).
(function () {
    'use strict';

    var ADMIN_NAV = [
        { section: 'Main' },
        { href: '/admin/dashboard', icon: 'fa-tachometer-alt', text: 'Dashboard' },
        { section: 'Employee Management' },
        { href: '/admin/employees', icon: 'fa-users', text: 'Employees' },
        { href: '/admin/departments', icon: 'fa-building', text: 'Departments' },
        { href: '/admin/designations', icon: 'fa-id-badge', text: 'Designations' },
        { href: '/admin/onboarding', icon: 'fa-user-plus', text: 'Onboarding' },
        { section: 'Time & Leave' },
        { href: '/admin/attendance', icon: 'fa-clock', text: 'Attendance' },
        { href: '/admin/leave', icon: 'fa-calendar-times', text: 'Leave' },
        { href: '/admin/wfh', icon: 'fa-home', text: 'WFH' },
        { href: '/admin/holidays', icon: 'fa-calendar-check', text: 'Holidays' },
        { section: 'Finance' },
        { href: '/admin/payroll', icon: 'fa-indian-rupee-sign', text: 'Payroll' },
        { section: 'Projects' },
        { href: '/admin/project-management', icon: 'fa-project-diagram', text: 'Projects' },
        { href: '/admin/project-reports', icon: 'fa-chart-line', text: 'Project Reports' },
        { section: 'Support' },
        { href: '/admin/tickets', icon: 'fa-ticket-alt', text: 'Queries' },
        { section: 'Communication' },
        { href: '/admin/announcements', icon: 'fa-bullhorn', text: 'Announcements' },
        { href: '/admin/documents', icon: 'fa-file-alt', text: 'Documents' },
        { section: 'Analytics' },
        { href: '/admin/reports', icon: 'fa-chart-bar', text: 'Reports' },
        { href: '/admin/audit-logs', icon: 'fa-clipboard-list', text: 'Audit Logs' },
        { href: '/admin/settings', icon: 'fa-cog', text: 'Settings' }
    ];

    var EMPLOYEE_NAV = [
        { section: 'Main' },
        { href: '/employee/dashboard', icon: 'fa-tachometer-alt', text: 'Dashboard' },
        // My Team link is injected dynamically for manager/team_lead by dashboard.js loadManagerNav().
        // Kept in markup for the manager page itself (active state handled below).
        { href: '/manager/my-team', icon: 'fa-users', text: 'My Team', managerOnly: true },
        { section: 'My Info' },
        { href: '/employee/profile', icon: 'fa-user', text: 'My Profile' },
        { href: '/employee/onboarding', icon: 'fa-user-plus', text: 'My Onboarding' },
        { href: '/employee/my-projects', icon: 'fa-project-diagram', text: 'My Projects' },
        { href: '/employee/attendance', icon: 'fa-clock', text: 'Attendance' },
        { href: '/employee/regularization', icon: 'fa-clock-rotate-left', text: 'Regularization' },
        { href: '/employee/leave', icon: 'fa-calendar-times', text: 'Leave' },
        { href: '/employee/wfh', icon: 'fa-home', text: 'WFH' },
        { href: '/employee/payslips', icon: 'fa-indian-rupee-sign', text: 'Payslips' },
        { section: 'Company' },
        { href: '/employee/documents', icon: 'fa-file-alt', text: 'Documents' },
        { href: '/employee/announcements', icon: 'fa-bullhorn', text: 'Announcements' },
        { section: 'Support' },
        { href: '/employee/holidays', icon: 'fa-calendar-check', text: 'Holidays' },
        { section: 'Resources' },
        { href: '/employee/directory', icon: 'fa-address-book', text: 'Directory' },
        { href: '/employee/tickets', icon: 'fa-ticket-alt', text: 'My Queries' }
    ];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildNav(items, activePath, isEmployeeShell) {
        var html = '';
        items.forEach(function (item) {
            if (item.section) {
                html += '<div class="nav-section-title">' + esc(item.section) + '</div>';
                return;
            }
            // On employee pages the My Team row is hidden unless manager view;
            // dashboard.js unhides it for approvers. Keep same id/behaviour.
            var extra = '';
            if (item.managerOnly) {
                // Only render it when we are on the manager page or when dashboard.js
                // will unhide it. Preserve old id for compat.
                if (isEmployeeShell && activePath !== '/manager/my-team') {
                    extra = ' id="myTeamLink" style="display:none;"';
                }
            }
            var active = activePath === item.href ? ' active' : '';
            html += '<a href="' + esc(item.href) + '" class="nav-item' + active + '"' + extra + '>' +
                '<i class="fas ' + esc(item.icon) + '"></i>' +
                '<span class="nav-text">' + esc(item.text) + '</span></a>';
        });
        return html;
    }

    function currentActivePath(fallback) {
        var p = document.body.getAttribute('data-active') || window.location.pathname || '';
        // Tolerate legacy "/admin/x.html" links
        if (p.toLowerCase().endsWith('.html')) p = p.slice(0, -5);
        return p || fallback;
    }

    // Zero-risk mode: legacy pages keep their HTML, but the nav list itself
    // comes from this single source of truth. Active item is preserved.
    function hydrateLegacyNav() {
        var sidebarNav = document.querySelector('#sidebar .sidebar-nav');
        if (!sidebarNav) return false;
        var body = document.body;
        var isAdmin = body.classList.contains('admin-app');
        // Manager page uses employee shell
        var navItems = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;
        var activeLink = sidebarNav.querySelector('.nav-item.active');
        var activePath = currentActivePath(activeLink ? activeLink.getAttribute('href') : '');
        // Preserve manager-only visibility behaviour from original markup
        var hadHiddenTeamLink = !!sidebarNav.querySelector('#myTeamLink');
        var html = buildNav(navItems, activePath, !isAdmin);
        if (hadHiddenTeamLink && html.indexOf('id="myTeamLink"') === -1) {
            html = html.replace(
                '<a href="/manager/my-team" class="nav-item',
                '<a href="/manager/my-team" id="myTeamLink" style="display:none;" class="nav-item'
            );
        }
        // Only replace when item count matches expectation (avoid clobbering
        // hand-customised pages). Admin=20 links, employee=15 links + team.
        var newCount = (html.match(/nav-item/g) || []).length;
        var oldCount = sidebarNav.querySelectorAll('.nav-item').length;
        if (Math.abs(newCount - oldCount) > 2) return false;
        sidebarNav.innerHTML = html;
        return true;
    }

    // Keka-style bottom nav for the employee PWA (mobile only via CSS).
    // Purely additive: hidden on desktop, never touches sidebar/header.
    var BOTTOM_NAV = [
        { href: '/employee/dashboard', icon: 'fa-home', text: 'Home' },
        { href: '/employee/attendance', icon: 'fa-clock', text: 'Check-in' },
        { href: '/employee/leave', icon: 'fa-calendar-times', text: 'Leave' },
        { href: '/employee/payslips', icon: 'fa-indian-rupee-sign', text: 'Pay' }
    ];

    function renderBottomNav() {
        if (!document.body.classList.contains('employee-app')) return;
        if (document.querySelector('.bottom-nav')) return;
        var activePath = currentActivePath('');
        var html = BOTTOM_NAV.map(function (item) {
            var active = activePath === item.href ? ' active' : '';
            return '<a href="' + esc(item.href) + '" class="bottom-nav-item' + active + '">' +
                '<i class="fas ' + esc(item.icon) + '"></i><span>' + esc(item.text) + '</span></a>';
        }).join('');
        html += '<button type="button" class="bottom-nav-item" onclick="toggleSidebar()" aria-label="More menu">' +
            '<i class="fas fa-bars"></i><span>More</span></button>';
        var nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.setAttribute('aria-label', 'Primary');
        nav.innerHTML = html;
        document.body.appendChild(nav);
    }

    function renderShell() {
        var mount = document.getElementById('app-shell');
        if (!mount) {
            hydrateLegacyNav();
            renderBottomNav();
            return;
        } // not opted-in: only sync nav list, leave everything else untouched
        if (mount.getAttribute('data-rendered') === '1') return;

        var body = document.body;
        var isAdmin = body.classList.contains('admin-app');
        var role = isAdmin ? 'admin' : 'employee';
        var activePath = body.getAttribute('data-active') || window.location.pathname;
        var pageTitle = body.getAttribute('data-page-title') || document.title.split(' - ')[0] || 'Dashboard';
        var settingsUrl = isAdmin ? '/admin/settings' : '/employee/profile';
        var settingsLabel = isAdmin ? 'Settings' : 'My Profile';
        var settingsIcon = isAdmin ? 'fa-cog' : 'fa-user';

        var navItems = isAdmin ? ADMIN_NAV : EMPLOYEE_NAV;
        var navHtml = buildNav(navItems, activePath, !isAdmin);

        mount.setAttribute('data-rendered', '1');
        mount.innerHTML =
            '<aside class="sidebar" id="sidebar">' +
            '<div class="sidebar-header"><div class="sidebar-logo">' +
            '<i class="fas fa-building" style="color:var(--primary-light);font-size:1.5rem;"></i>' +
            '<span style="font-size:1rem;font-weight:700;">Gensar HRMS</span></div></div>' +
            '<nav class="sidebar-nav">' + navHtml + '</nav></aside>' +
            '<main class="main-content" id="mainContent">' +
            '<header class="header"><div class="header-left">' +
            '<button class="menu-toggle" onclick="toggleSidebar()" aria-label="Toggle menu"><i class="fas fa-bars"></i></button>' +
            '<h2 style="font-size:1.25rem;font-weight:600;">' + esc(pageTitle) + '</h2></div>' +
            '<div class="header-right">' +
            '<button type="button" class="notification-btn" title="Notifications" aria-label="Notifications"><i class="fas fa-bell"></i>' +
            '<span class="notification-badge" id="notifBadge" style="display:none;"></span></button>' +
            '<button class="notification-btn" onclick="toggleDarkMode()" title="Toggle dark mode" aria-label="Toggle dark mode"><i class="fas fa-moon" id="themeIcon"></i></button>' +
            '<div style="position:relative"><button class="profile-btn" onclick="toggleProfileMenu()" aria-label="Profile menu">' +
            '<span class="profile-photo" id="profilePhoto" style="display:inline-flex;align-items:center;justify-content:center;background:var(--primary);color:white;border-radius:50%;width:36px;height:36px;font-size:0.8rem;font-weight:600;"></span>' +
            '<span id="profileName" style="margin-left:8px;font-weight:500;"></span>' +
            '<i class="fas fa-chevron-down" style="margin-left:4px;font-size:0.7rem;"></i></button>' +
            '<div class="profile-menu" id="profileMenu" style="display:none;">' +
            '<a href="' + esc(settingsUrl) + '" class="profile-menu-item"><i class="fas ' + esc(settingsIcon) + '"></i> ' + esc(settingsLabel) + '</a>' +
            '<div class="profile-menu-divider"></div>' +
            '<a href="#" class="profile-menu-item danger" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</a>' +
            '</div></div></div></header>';
        renderBottomNav();
    }

    // Expose for tests / future phases; auto-render on DOM ready.
    window.GensarLayout = {
        render: renderShell,
        ADMIN_NAV: ADMIN_NAV,
        EMPLOYEE_NAV: EMPLOYEE_NAV
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderShell);
    } else {
        renderShell();
    }
})();
