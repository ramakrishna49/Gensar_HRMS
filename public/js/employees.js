        if (!requireAdmin()) throw new Error('Not authenticated');
        let allEmployees = [];
        let departmentsCache = [];
        let pendingCounts = {};
        let currentViewEmployee = null;
        let currentViewRequests = [];
        let allEmployeesForRM = [];
        let designationsCache = [];

        document.addEventListener('DOMContentLoaded', () => {
            const me = getCurrentUser();
            if (me && me.role !== 'admin') {
                document.querySelectorAll('#addRole option[value="admin"], #editRole option[value="admin"]').forEach(o => o.remove());
            }
            loadEmployees();
            // Apply ?department=<id> (e.g. from the Departments page cards)
            // once the filter dropdown options exist.
            loadDepartments().then(() => {
                const deptParam = new URLSearchParams(window.location.search).get('department');
                if (deptParam) {
                    document.getElementById('filterDept').value = deptParam;
                    filterEmployees();
                }
            });
            loadDesignations();
            loadReportingManagers();
            loadPendingCounts().then(() => {
                renderEmployees(allEmployees);
                const params = new URLSearchParams(window.location.search);
                const empId = params.get('emp');
                const tab = params.get('tab') || 'overview';
                if (empId) {
                    viewEmployee(Number(empId)).then(() => {
                        showViewTab(tab === 'requests' ? 'requests' : 'overview');
                    });
                }
            });
        });

        async function loadEmployees() {
            const data = await apiCall('/employees?limit=1000');
            if (data && data.success) {
                allEmployees = data.employees;
                updateStats(data.employees);
                renderEmployees(data.employees);
            } else {
                showEmptyState(document.getElementById('employeesTable'), 'fa-exclamation-triangle', 'Error', 'Failed to load employees');
            }
        }

        function updateStats(employees) {
            document.getElementById('totalCount').textContent = employees.length;
            document.getElementById('activeCount').textContent = employees.filter(e => e.status === 'active').length;
            document.getElementById('inactiveCount').textContent = employees.filter(e => e.status !== 'active').length;
            const now = new Date();
            const thisMonth = employees.filter(e => {
                if (!e.joining_date) return false;
                const d = new Date(e.joining_date);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length;
            document.getElementById('newMonthCount').textContent = thisMonth;
        }

        const EMPLOYEE_FIELDS = [
            ['personal_email', 'Personal Email'], ['date_of_birth', 'Date of Birth'], ['gender', 'Gender'],
            ['blood_group', 'Blood Group'], ['marital_status', 'Marital Status'], ['languages_spoken', 'Languages Spoken'],
            ['address', 'Current Address'], ['permanent_address', 'Permanent Address'],
            ['emergency_contact_name', 'Emergency Contact Name'], ['emergency_contact', 'Emergency Contact'],
            ['qualification', 'Qualification'], ['specialization', 'Specialization'],
            ['pan_number', 'PAN Number'], ['aadhaar_number', 'Aadhaar Number'], ['passport_number', 'Passport Number'],
            ['bank_name', 'Bank Name'], ['bank_branch', 'Bank Branch'], ['bank_account', 'Bank Account'], ['bank_ifsc', 'IFSC Code']
        ];

        function getIncompleteFields(emp) {
            if (!emp) return [];
            return EMPLOYEE_FIELDS.filter(([f]) => emp[f] == null || String(emp[f]).trim() === '');
        }

        function getIncompleteCount(emp) { return getIncompleteFields(emp).length; }

        // Client-side pagination over the loaded cache: the /employees fetch
        // stays exactly as before (same limit, same filters server-side);
        // only rendering is windowed so 1000+ rows no longer freeze the DOM.
        const EMP_PAGE_SIZE = 50;
        let empFiltered = [];
        let empPage = 1;
        let empFilterTimer = null;

        function renderEmployees(employees, keepPage) {
            const tbody = document.getElementById('employeesTable');
            if (employees.length === 0) {
                empFiltered = [];
                tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><i class="fas fa-users"></i><h3>No Employees Found</h3><p>Try adjusting your filters or add a new employee.</p></div></td></tr>';
                renderEmpPager();
                return;
            }
            const sorted = [...employees].sort((a, b) => {
                const order = { active: 0, inactive: 1, paused: 1, on_hold: 1, absconded: 2, terminated: 3 };
                return (order[a.status] ?? 1) - (order[b.status] ?? 1);
            });
            empFiltered = sorted;
            if (!keepPage) empPage = 1;
            const pages = Math.max(Math.ceil(sorted.length / EMP_PAGE_SIZE), 1);
            if (empPage > pages) empPage = pages;
            const slice = sorted.slice((empPage - 1) * EMP_PAGE_SIZE, empPage * EMP_PAGE_SIZE);
            tbody.innerHTML = slice.map(emp => {
                const isActive = emp.status === 'active';
                const isTerminated = emp.status === 'terminated';
                const isPaused = emp.status === 'paused';
                const isOnHold = emp.status === 'on_hold';
                const isAbsconded = emp.status === 'absconded';
                const isInactive = emp.status === 'inactive';
                const holdTitle = emp.status_reason ? 'Reason: ' + emp.status_reason + (emp.last_working_day ? ' | LWD: ' + String(emp.last_working_day).substring(0,10) : '') : emp.status;
                const incFields = getIncompleteFields(emp);
                const incCount = incFields.length;
                const incLabel = incCount > 0 ? (incCount + ' from employee') : 'Complete';
                const incTitle = incCount > 0 ? 'Pending from employee: ' + incFields.map(f => f[1]).join(', ') : 'All personal details provided';
                return `
                <tr${!isActive ? ' style="opacity:0.6;"' : ''}>
                    <td>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:600;flex-shrink:0;">${escapeHtml(getInitials(emp.first_name, emp.last_name))}</div>
                            <div>
                                <div style="font-weight:500;">${escapeHtml(emp.first_name)} ${escapeHtml(emp.last_name)}</div>
                                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                                    ${pendingCounts[emp.id] ? `<span class="badge badge-warning" style="font-size:0.6rem;margin-top:2px;" title="Pending update requests">${pendingCounts[emp.id]} pending</span>` : ''}
                                    <span class="badge ${incCount > 0 ? 'badge-secondary' : 'badge-success'}" style="font-size:0.6rem;margin-top:2px;" title="${escapeHtml(incTitle)}">${incLabel}</span>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td><strong>${escapeHtml(emp.employee_id)}</strong></td>
                    <td>${escapeHtml(emp.email)}</td>
                    <td>${escapeHtml(emp.phone || '-')}</td>
                    <td>${escapeHtml(emp.department_name || '-')}</td>
                    <td>${escapeHtml(emp.designation_name || '-')}${emp.designation_level ? '<br><span class="badge badge-secondary" style="font-size:0.62rem;">Level ' + escapeHtml(String(emp.designation_level)) + '</span>' : ''}</td>
                    <td>${emp.reporting_manager_name ? '<span style="font-size:0.85rem;">' + escapeHtml(emp.reporting_manager_name) + '</span><br><span class="badge badge-secondary" style="font-size:0.62rem;">' + escapeHtml(emp.reporting_manager_employee_id || '') + '</span>' : '<span class="badge badge-secondary" style="font-size:0.7rem;">Not Assigned</span>'}</td>
                    <td><span class="badge badge-${emp.role==='admin'?'danger':emp.role==='hr'?'warning':emp.role==='manager'?'info':emp.role==='team_lead'?'primary':'secondary'}">${escapeHtml(emp.role)}</span></td>
                    <td><span class="badge badge-${getStatusBadge(emp.status)}" title="${escapeHtml(holdTitle)}">${escapeHtml(emp.status)}${emp.status_reason ? '*' : ''}</span></td>
                    <td>
                        <div style="display:flex;gap:4px;flex-wrap:wrap;">
                            <button class="btn btn-sm btn-info" onclick="viewEmployee(${emp.id})" title="View"><i class="fas fa-eye"></i></button>
                            <button class="btn btn-sm btn-secondary" onclick="editEmployee(${emp.id})" title="Edit"><i class="fas fa-edit"></i></button>
                            ${isActive
                                ? `<button class="btn btn-sm btn-warning" onclick="toggleEmployeeStatus(${emp.id}, 'inactive')" title="Deactivate"><i class="fas fa-pause-circle"></i></button>
                                   <button class="btn btn-sm btn-info" onclick="pauseEmployee(${emp.id})" title="Pause (temp)"><i class="fas fa-pause"></i></button>
                                   <button class="btn btn-sm btn-warning" onclick="openStatusModal(${emp.id}, 'hold')" title="Hold with reason"><i class="fas fa-circle-pause"></i></button>
                                   <button class="btn btn-sm btn-dark" onclick="openStatusModal(${emp.id}, 'abscond')" title="Mark absconded" style="background:#1f2937;border-color:#1f2937;color:#fff;"><i class="fas fa-user-slash"></i></button>
                                   <button class="btn btn-sm btn-danger" onclick="openStatusModal(${emp.id}, 'terminate')" title="Terminate with reason"><i class="fas fa-trash"></i></button>`
                                : isOnHold
                                    ? `<button class="btn btn-sm btn-success" onclick="unholdEmployee(${emp.id})" title="Release from hold"><i class="fas fa-play"></i></button>
                                       <button class="btn btn-sm btn-dark" onclick="openStatusModal(${emp.id}, 'abscond')" title="Mark absconded" style="background:#1f2937;border-color:#1f2937;color:#fff;"><i class="fas fa-user-slash"></i></button>
                                       <button class="btn btn-sm btn-danger" onclick="openStatusModal(${emp.id}, 'terminate')" title="Terminate with reason"><i class="fas fa-trash"></i></button>`
                                    : isPaused
                                    ? `<button class="btn btn-sm btn-success" onclick="resumeEmployee(${emp.id})" title="Resume"><i class="fas fa-play"></i></button>
                                       <button class="btn btn-sm btn-warning" onclick="openStatusModal(${emp.id}, 'hold')" title="Hold with reason"><i class="fas fa-circle-pause"></i></button>
                                       <button class="btn btn-sm btn-danger" onclick="openStatusModal(${emp.id}, 'terminate')" title="Terminate with reason"><i class="fas fa-trash"></i></button>`
                                    : isAbsconded
                                    ? `<button class="btn btn-sm btn-success" onclick="rehireEmployee(${emp.id})" title="Rejoin (same ID)"><i class="fas fa-undo"></i></button>
                                       <button class="btn btn-sm btn-danger" onclick="openStatusModal(${emp.id}, 'terminate')" title="Convert to terminated"><i class="fas fa-trash"></i></button>`
                                    : isTerminated
                                    ? `<button class="btn btn-sm btn-success" onclick="rehireEmployee(${emp.id})" title="Rehire (same Employee ID)"><i class="fas fa-undo"></i></button>`
                                    : `<button class="btn btn-sm btn-success" onclick="toggleEmployeeStatus(${emp.id}, 'active')" title="Activate"><i class="fas fa-play-circle"></i></button>
                                       <button class="btn btn-sm btn-warning" onclick="openStatusModal(${emp.id}, 'hold')" title="Hold with reason"><i class="fas fa-circle-pause"></i></button>`
                            }
                        </div>
                    </td>
                </tr>`;
                }).join('');
            renderEmpPager();
        }

        function renderEmpPager() {
            const pager = document.getElementById('empPager');
            if (!pager) return;
            const pages = Math.ceil(empFiltered.length / EMP_PAGE_SIZE);
            if (pages <= 1 || empFiltered.length === 0) { pager.style.display = 'none'; pager.innerHTML = ''; return; }
            pager.style.display = 'flex';
            const start = (empPage - 1) * EMP_PAGE_SIZE + 1;
            const end = Math.min(empPage * EMP_PAGE_SIZE, empFiltered.length);
            let nums = [];
            for (let p = 1; p <= pages; p++) {
                if (p === 1 || p === pages || Math.abs(p - empPage) <= 1) nums.push(p);
                else if (nums[nums.length - 1] !== '…') nums.push('…');
            }
            pager.innerHTML =
                '<span style="font-size:0.8rem;color:var(--text-secondary);margin-right:4px;">' + start + '–' + end + ' of ' + empFiltered.length + '</span>' +
                '<button class="pagination-btn" onclick="empGoPage(' + (empPage - 1) + ')" ' + (empPage <= 1 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>' +
                nums.map(p => p === '…'
                    ? '<span style="padding:0 4px;color:var(--text-tertiary);">…</span>'
                    : '<button class="pagination-btn' + (p === empPage ? ' active' : '') + '" onclick="empGoPage(' + p + ')">' + p + '</button>'
                ).join('') +
                '<button class="pagination-btn" onclick="empGoPage(' + (empPage + 1) + ')" ' + (empPage >= pages ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
        }

        function empGoPage(n) {
            const pages = Math.max(Math.ceil(empFiltered.length / EMP_PAGE_SIZE), 1);
            empPage = Math.min(Math.max(parseInt(n, 10) || 1, 1), pages);
            renderEmployees(empFiltered, true);
            document.querySelector('#employeesTable').scrollIntoView({ block: 'nearest' });
        }

        // Branded Excel export is generated server-side (ExcelJS) so every
        // report ships with the company header, frozen styled columns and
        // proper money/date formats.
        function downloadEmployeesExcel() {
            showToast('Generating Excel...', 'info');
            downloadWithAuth('/employees/export', 'Employees_' + new Date().toISOString().split('T')[0] + '.xlsx');
        }

        function filterEmployees() {
            // Debounced: typing re-renders at most ~4x/sec instead of per keystroke
            if (empFilterTimer) clearTimeout(empFilterTimer);
            empFilterTimer = setTimeout(applyEmpFilters, 250);
        }

        function applyEmpFilters() {
            const search = document.getElementById('searchInput').value.toLowerCase();
            const dept = document.getElementById('filterDept').value;
            const status = document.getElementById('filterStatus').value;
            let filtered = allEmployees;
            if (search) {
                filtered = filtered.filter(e =>
                    (e.first_name || '').toLowerCase().includes(search) ||
                    (e.last_name || '').toLowerCase().includes(search) ||
                    (e.email || '').toLowerCase().includes(search) ||
                    (e.employee_id || '').toLowerCase().includes(search)
                );
            }
            if (dept) filtered = filtered.filter(e => String(e.department_id) === dept);
            if (status) filtered = filtered.filter(e => e.status === status);
            renderEmployees(filtered);
        }

        async function loadDepartments() {
            const data = await apiCall('/departments');
            if (data && data.success) {
                departmentsCache = data.departments;
                const html = '<option value="">All Departments</option>' + data.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
                document.getElementById('filterDept').innerHTML = html;
                document.getElementById('departmentSelect').innerHTML = '<option value="">Select Department</option>' + data.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
                document.getElementById('editDepartment').innerHTML = '<option value="">Select Department</option>' + data.departments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
            }
        }

        async function loadDesignations() {
            const data = await apiCall('/designations');
            if (data && data.success) {
                designationsCache = data.designations;
                const html = '<option value="">Select Designation</option>' + data.designations.map(d => `<option value="${d.id}">${escapeHtml(d.name)}${d.level ? ' (Level ' + escapeHtml(String(d.level)) + ')' : ''}</option>`).join('');
                document.getElementById('designationSelect').innerHTML = html;
                document.getElementById('editDesignation').innerHTML = html;
            }
        }

        const RM_ROLE_MAP = {
            employee: ['team_lead'],
            team_lead: ['manager'],
            manager: ['admin'],
            hr: ['manager'],
            admin: []
        };

        const ROLE_LABEL = { employee: 'Employee', team_lead: 'Team Lead', manager: 'Manager', hr: 'HR', admin: 'Admin' };
        function rmCandidatesFor(role) {
            const wanted = RM_ROLE_MAP[role] || [];
            return allEmployeesForRM.filter(e => wanted.includes(e.role) && e.status === 'active');
        }

        function renderRMOptions(role, selectEl, currentId) {
            const candidates = rmCandidatesFor(role);
            const opt = (e, labelOverride) => `<option value="${e.id}">${escapeHtml(labelOverride || (e.first_name + ' ' + e.last_name) + ' (' + (e.employee_id || '') + ')')}</option>`;
            let html = '<option value="">' + (role === 'admin' ? 'Admin is top of chain' : 'Select Reporting Person') + '</option>';
            if (currentId && !candidates.some(c => String(c.id) === String(currentId))) {
                const cur = allEmployeesForRM.find(e => String(e.id) === String(currentId));
                if (cur) html += opt(cur, cur.first_name + ' ' + cur.last_name + ' (' + (cur.employee_id || '') + ') - current');
            }
            html += candidates.map(e => opt(e)).join('');
            selectEl.innerHTML = html;
            if (currentId) selectEl.value = currentId;
        }

        function onRoleChange(selectEl, rmEl, currentId) {
            renderRMOptions(selectEl.value, rmEl, currentId);
        }

        function onDesignationChange(selectEl, rmEl, roleEl) {
            const des = designationsCache.find(d => String(d.id) === String(selectEl.value));
            if (des && des.team_lead_id && roleEl.value === 'employee') {
                const tlInList = allEmployeesForRM.some(e => String(e.id) === String(des.team_lead_id) && e.role === 'team_lead' && e.status === 'active');
                if (tlInList) rmEl.value = String(des.team_lead_id);
            }
        }

        async function loadReportingManagers() {
            const data = await apiCall('/employees?limit=1000');
            if (data && data.success) {
                allEmployeesForRM = data.employees || [];
                const addRole = document.getElementById('addRole');
                const editRole = document.getElementById('editRole');
                renderRMOptions(addRole.value, document.getElementById('reportingManagerSelect'));
                renderRMOptions(editRole.value, document.getElementById('editReportingManager'));
            }
        }

        document.addEventListener('change', function(e) {
            if (e.target && e.target.id === 'addRole') {
                onRoleChange(e.target, document.getElementById('reportingManagerSelect'));
            } else if (e.target && e.target.id === 'editRole') {
                onRoleChange(e.target, document.getElementById('editReportingManager'), document.getElementById('editReportingManager').dataset.currentRm || '');
            } else if (e.target && e.target.id === 'designationSelect') {
                onDesignationChange(e.target, document.getElementById('reportingManagerSelect'), document.getElementById('addRole'));
            } else if (e.target && e.target.id === 'editDesignation') {
                onDesignationChange(e.target, document.getElementById('editReportingManager'), document.getElementById('editRole'));
            }
        });

        function openAddEmployeeModal() { addWizShow(1); document.getElementById('addEmployeeModal').classList.add('active'); }

        // Add-Employee wizard (Company -> Salary -> Review). Field names and
        // the POST body built by addEmployee() are unchanged - this only
        // changes which section is visible.
        function addWizShow(n) {
            document.querySelectorAll('#addEmployeeForm .wiz-step').forEach(function (el) {
                el.style.display = el.getAttribute('data-wiz') === String(n) ? '' : 'none';
            });
            document.querySelectorAll('#addWizSteps .wiz-step-dot').forEach(function (el) {
                const i = parseInt(el.getAttribute('data-wiz-dot'), 10);
                el.classList.toggle('active', i === n);
                el.classList.toggle('done', i < n);
            });
            document.getElementById('addWizBack').style.display = n === 1 ? 'none' : '';
            document.getElementById('addWizNext').style.display = n === 3 ? 'none' : '';
            document.getElementById('addWizSubmit').style.display = n === 3 ? '' : 'none';
            if (n === 3) fillAddReview();
        }

        function addWizGo(n) {
            if (n > 1) {
                // Step-1 gate: same required fields the server enforces
                const form = document.getElementById('addEmployeeForm');
                const need = ['employee_id', 'first_name', 'last_name', 'email', 'joining_date'];
                for (const name of need) {
                    const el = form.elements[name];
                    if (!el || String(el.value || '').trim() === '') {
                        showToast('Please fill Employee ID, name, official email and joining date first', 'warning');
                        if (el && el.focus) el.focus();
                        return;
                    }
                }
                const email = String(form.elements['email'].value || '').trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    showToast('Official email looks invalid', 'warning');
                    form.elements['email'].focus();
                    return;
                }
                const uan = String((form.elements['uan_number'] && form.elements['uan_number'].value) || '').trim();
                if (uan && !/^[0-9]{12}$/.test(uan)) {
                    showToast('UAN must be exactly 12 digits', 'warning');
                    form.elements['uan_number'].focus();
                    return;
                }
            }
            addWizShow(n);
        }

        function wizVal(name) {
            const form = document.getElementById('addEmployeeForm');
            const el = form.elements[name];
            return el ? String(el.value || '').trim() : '';
        }

        function fillAddReview() {
            const deptSel = document.getElementById('departmentSelect');
            const roleSel = document.getElementById('addRole');
            const rows = [
                ['Employee ID', wizVal('employee_id')],
                ['Name', (wizVal('first_name') + ' ' + wizVal('last_name')).trim() || '-'],
                ['Official Email', wizVal('email')],
                ['Phone', wizVal('phone') || '-'],
                ['Department', deptSel && deptSel.selectedIndex > 0 ? deptSel.options[deptSel.selectedIndex].text : '-'],
                ['Role', roleSel ? roleSel.options[roleSel.selectedIndex].text : '-'],
                ['Joining Date', wizVal('joining_date') || '-'],
                ['Total Compensation', wizVal('salary') || '-']
            ];
            document.getElementById('addReviewBox').innerHTML = rows.map(([l, v]) =>
                '<div class="detail-row"><span class="detail-label">' + escapeHtml(l) + '</span>' +
                '<span class="detail-value">' + escapeHtml(v || '-') + '</span></div>'
            ).join('');
        }
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }

        async function addEmployee(event) {
            event.preventDefault();
            const form = event.target;
            const formData = new FormData(form);
            const data = Object.fromEntries(formData);
            // Checkbox has no name on purpose: unchecked boxes never appear in
            // FormData, and the backend only skips the mail on an explicit false.
            data.send_welcome_email = document.getElementById('sendWelcomeEmail').checked;
            const result = await apiCall('/employees', 'POST', data);
            if (result && result.success) {
                let msg = 'Employee added! Temp password: ' + (result.temp_password || 'welcome123');
                if (data.send_welcome_email) {
                    msg += result.email_sent
                        ? ' | Welcome email sent.'
                        : ' | Welcome email NOT sent (SMTP not configured or delivery failed).';
                }
                showToast(msg, result.email_sent || !data.send_welcome_email ? 'success' : 'warning');
                closeModal('addEmployeeModal');
                form.reset();
                document.getElementById('sendWelcomeEmail').checked = true;
                renderRMOptions(document.getElementById('addRole').value, document.getElementById('reportingManagerSelect'));
                loadEmployees();
            } else {
                showToast(result?.detail || result?.message || 'Failed to add employee', 'error');
            }
        }

        async function editEmployee(id) {
            const data = await apiCall(`/employees/${id}`);
            if (data && data.success) {
                const emp = data.employee;
                document.getElementById('editId').value = emp.id;
                document.getElementById('editEmpId').value = emp.employee_id;
                document.getElementById('editEmail').value = emp.email || '';
                document.getElementById('editFirstName').value = emp.first_name || '';
                document.getElementById('editLastName').value = emp.last_name || '';
                document.getElementById('editPhone').value = emp.phone || '';
                document.getElementById('editJoiningDate').value = emp.joining_date ? emp.joining_date.split('T')[0] : '';
                document.getElementById('editDepartment').value = emp.department_id || '';
                document.getElementById('editDesignation').value = emp.designation_id || '';
                document.getElementById('editRole').value = emp.role || 'employee';
                renderRMOptions(emp.role || 'employee', document.getElementById('editReportingManager'), emp.reporting_manager_id || '');
                document.getElementById('editReportingManager').dataset.currentRm = emp.reporting_manager_id || '';
                document.getElementById('editSalary').value = emp.salary || '';
                document.getElementById('editUAN').value = emp.uan_number || '';
                document.getElementById('editStatus').value = emp.status || 'active';
                document.getElementById('editGender').value = emp.gender || '';
                document.getElementById('editBloodGroup').value = emp.blood_group || '';
                document.getElementById('editDOB').value = emp.date_of_birth ? emp.date_of_birth.split('T')[0] : '';
                document.getElementById('editAddress').value = emp.address || '';
                document.getElementById('editPermanentAddress').value = emp.permanent_address || '';
                document.getElementById('editEmergencyName').value = emp.emergency_contact_name || '';
                document.getElementById('editEmergencyContact').value = emp.emergency_contact || '';
                document.getElementById('editMaritalStatus').value = emp.marital_status || '';
                document.getElementById('editLanguages').value = emp.languages_spoken || '';
                document.getElementById('editPersonalEmail').value = emp.personal_email || '';
                document.getElementById('editQualification').value = emp.qualification || '';
                document.getElementById('editSpecialization').value = emp.specialization || '';
                document.getElementById('editPAN').value = emp.pan_number || '';
                document.getElementById('editAadhaar').value = emp.aadhaar_number || '';
                document.getElementById('editPassport').value = emp.passport_number || '';
                document.getElementById('editBankName').value = emp.bank_name || '';
                document.getElementById('editBankBranch').value = emp.bank_branch || '';
                document.getElementById('editBankAccount').value = emp.bank_account || '';
                document.getElementById('editBankIFSC').value = emp.bank_ifsc || '';
                const setNum = (id, val) => { const el = document.getElementById(id); if (el) el.value = (val === null || val === undefined) ? '' : val; };
                setNum('editBasicSalary', emp.basic_salary); setNum('editHRA', emp.hra);
                setNum('editConveyance', emp.conveyance);
                setNum('editSpecialAllowance', emp.special_allowance); setNum('editOtherAllowance', emp.other_allowance);
                setNum('editEmployeePF', emp.pf); setNum('editEmployeeESI', emp.esi);
                setNum('editProfessionalTax', emp.professional_tax); setNum('editIncomeTax', emp.income_tax);
                setNum('editOtherDeduction', emp.other_deduction);
                setNum('editEmployerPF', emp.employer_pf); setNum('editEmployerESI', emp.employer_esi);
                setNum('editEmployerContribution', emp.employer_contribution);
                document.getElementById('editEmployeeModal').classList.add('active');
            }
        }

        async function updateEmployee(event) {
            event.preventDefault();
            const id = document.getElementById('editId').value;
            const data = {
                email: document.getElementById('editEmail').value,
                first_name: document.getElementById('editFirstName').value,
                last_name: document.getElementById('editLastName').value,
                phone: document.getElementById('editPhone').value,
                joining_date: document.getElementById('editJoiningDate').value || undefined,
                department_id: document.getElementById('editDepartment').value || undefined,
                designation_id: document.getElementById('editDesignation').value || undefined,
                reporting_manager_id: document.getElementById('editReportingManager').value || '',
                salary: document.getElementById('editSalary').value || undefined,
                uan_number: document.getElementById('editUAN').value || undefined,
                role: document.getElementById('editRole').value,
                status: document.getElementById('editStatus').value,
                gender: document.getElementById('editGender').value || undefined,
                blood_group: document.getElementById('editBloodGroup').value || undefined,
                date_of_birth: document.getElementById('editDOB').value || undefined,
                address: document.getElementById('editAddress').value || undefined,
                permanent_address: document.getElementById('editPermanentAddress').value || undefined,
                emergency_contact_name: document.getElementById('editEmergencyName').value || undefined,
                emergency_contact: document.getElementById('editEmergencyContact').value || undefined,
                marital_status: document.getElementById('editMaritalStatus').value || undefined,
                languages_spoken: document.getElementById('editLanguages').value || undefined,
                personal_email: document.getElementById('editPersonalEmail').value || undefined,
                qualification: document.getElementById('editQualification').value || undefined,
                specialization: document.getElementById('editSpecialization').value || undefined,
                pan_number: document.getElementById('editPAN').value || undefined,
                aadhaar_number: document.getElementById('editAadhaar').value || undefined,
                passport_number: document.getElementById('editPassport').value || undefined,
                bank_name: document.getElementById('editBankName').value || undefined,
                bank_branch: document.getElementById('editBankBranch').value || undefined,
                bank_account: document.getElementById('editBankAccount').value || undefined,
                bank_ifsc: document.getElementById('editBankIFSC').value || undefined,
                basic_salary: document.getElementById('editBasicSalary').value || undefined,
                hra: document.getElementById('editHRA').value || undefined,
                conveyance: document.getElementById('editConveyance').value || undefined,
                special_allowance: document.getElementById('editSpecialAllowance').value || undefined,
                other_allowance: document.getElementById('editOtherAllowance').value || undefined,
                pf: document.getElementById('editEmployeePF').value || undefined,
                esi: document.getElementById('editEmployeeESI').value || undefined,
                professional_tax: document.getElementById('editProfessionalTax').value || undefined,
                income_tax: document.getElementById('editIncomeTax').value || undefined,
                other_deduction: document.getElementById('editOtherDeduction').value || undefined,
                employer_pf: document.getElementById('editEmployerPF').value || undefined,
                employer_esi: document.getElementById('editEmployerESI').value || undefined,
                employer_contribution: document.getElementById('editEmployerContribution').value || undefined
            };
            const result = await apiCall(`/employees/${id}`, 'PUT', data);
            if (result && result.success) {
                showToast('Employee updated successfully!', 'success');
                closeModal('editEmployeeModal');
                loadEmployees();
            } else {
                showToast(result?.detail || result?.message || 'Failed to update employee', 'error');
            }
        }

        function toggleEmployeeStatus(id, newStatus) {
            const action = newStatus === 'active' ? 'Activate' : 'Deactivate';
            showConfirmDialog(action + ' Employee', 'Are you sure you want to ' + action.toLowerCase() + ' this employee?', action, newStatus === 'active' ? 'btn-success' : 'btn-warning', function() {
                apiCall(`/employees/${id}`, 'PUT', { status: newStatus }).then(result => {
                    if (result && result.success) {
                        showToast('Employee ' + action.toLowerCase() + 'd successfully!', 'success');
                        loadEmployees();
                    } else {
                        showToast(result?.message || 'Failed to update status', 'error');
                    }
                });
            });
        }

        async function deleteEmployee(id) {
            showConfirmDialog('Terminate Employee', 'Are you sure you want to terminate this employee? This action can be reversed by setting status to active.', 'Terminate', 'btn-danger', async () => {
                const result = await apiCall(`/employees/${id}`, 'DELETE');
                if (result && result.success) {
                    showToast('Employee terminated successfully', 'success');
                    await Promise.all([loadEmployees(), loadPendingCounts()]);
                    if (currentViewEmployee && String(currentViewEmployee.id) === String(id)) viewEmployee(id);
                } else {
                    showToast(result?.message || 'Failed to terminate employee', 'error');
                }
            });
        }

        async function pauseEmployee(id) {
            showConfirmDialog('Pause Employee', 'Pause this employee? They will not be able to log in or check in, but all their data will be kept.', 'Pause', 'btn-warning', async () => {
                const result = await apiCall(`/employees/${id}/pause`, 'POST');
                if (result && result.success) {
                    showToast('Employee paused successfully', 'success');
                    await Promise.all([loadEmployees(), loadPendingCounts()]);
                    if (currentViewEmployee && String(currentViewEmployee.id) === String(id)) viewEmployee(id);
                } else {
                    showToast(result?.message || 'Failed to pause employee', 'error');
                }
            });
        }

        async function resumeEmployee(id) {
            const result = await apiCall(`/employees/${id}/resume`, 'POST');
            if (result && result.success) {
                showToast('Employee resumed successfully', 'success');
                await Promise.all([loadEmployees(), loadPendingCounts()]);
                if (currentViewEmployee && String(currentViewEmployee.id) === String(id)) viewEmployee(id);
            } else {
                showToast(result?.message || 'Failed to resume employee', 'error');
            }
        }

        let statusActionTargetId = null;
        let statusActionType = null;
        function openStatusModal(id, type) {
            statusActionTargetId = id;
            statusActionType = type;
            const emp = (allEmployees || []).find(e => String(e.id) === String(id)) || {};
            const name = ((emp.first_name || '') + ' ' + (emp.last_name || '')).trim() + (emp.employee_id ? ' (' + emp.employee_id + ')' : '');
            const titles = { hold: 'Hold Employee', abscond: 'Mark Absconded', terminate: 'Terminate Employee' };
            const descs = {
                hold: 'Account Hold: login blocked, data safe. Reason + Last Working Day mandatory. ' + name,
                abscond: 'Abscond: employee left without intimation. Login blocked, data safe. Reason + Last Working Day mandatory. ' + name,
                terminate: 'Terminate: permanent exit. Login blocked, data kept, rehire possible with same Employee ID. Reason + Last Working Day mandatory. ' + name
            };
            document.getElementById('statusModalTitle').textContent = titles[type] || 'Update Status';
            document.getElementById('statusModalDesc').textContent = descs[type] || name;
            document.getElementById('statusReason').value = '';
            document.getElementById('statusLwd').value = '';
            document.getElementById('statusActionModal').classList.add('active');
        }

        async function confirmStatusAction() {
            const reason = document.getElementById('statusReason').value.trim();
            const lwd = document.getElementById('statusLwd').value;
            if (!reason || reason.length < 3) { showToast('Reason is required (min 3 characters)', 'error'); return; }
            if (!lwd) { showToast('Last working day is required', 'error'); return; }
            const d = new Date(lwd);
            if (isNaN(d.getTime())) { showToast('Invalid last working day', 'error'); return; }
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const dd = new Date(d); dd.setHours(0, 0, 0, 0);
            if (dd > today) { showToast('Last working day cannot be in the future', 'error'); return; }
            const endpoint = statusActionType === 'hold' ? 'hold' : statusActionType === 'abscond' ? 'abscond' : 'terminate';
            const result = await apiCall(`/employees/${statusActionTargetId}/${endpoint}`, 'POST', { reason, last_working_day: lwd });
            if (result && result.success) {
                showToast(result.message || 'Status updated successfully', 'success');
                closeModal('statusActionModal');
                await Promise.all([loadEmployees(), loadPendingCounts()]);
                if (currentViewEmployee && String(currentViewEmployee.id) === String(statusActionTargetId)) viewEmployee(statusActionTargetId);
            } else {
                showToast((result && result.errors ? result.errors.join('; ') : result?.message) || 'Failed to update status', 'error');
            }
        }

        async function unholdEmployee(id) {
            const result = await apiCall(`/employees/${id}/unhold`, 'POST', {});
            if (result && result.success) {
                showToast('Employee released from hold successfully', 'success');
                await Promise.all([loadEmployees(), loadPendingCounts()]);
                if (currentViewEmployee && String(currentViewEmployee.id) === String(id)) viewEmployee(id);
            } else {
                showToast(result?.message || 'Failed to release from hold', 'error');
            }
        }

        async function rehireEmployee(id) {
            showConfirmDialog('Rehire Employee', 'Rehire with SAME Employee ID? All old data stays, status becomes active.', 'Rehire', 'btn-success', async () => {
                const result = await apiCall(`/employees/${id}/rehire`, 'POST', {});
                if (result && result.success) {
                    showToast('Employee rehired successfully with same Employee ID', 'success');
                    await Promise.all([loadEmployees(), loadPendingCounts()]);
                    if (currentViewEmployee && String(currentViewEmployee.id) === String(id)) viewEmployee(id);
                } else {
                    showToast(result?.message || 'Failed to rehire employee', 'error');
                }
            });
        }

        let permanentDeleteTargetId = null;
        function openPermanentDeleteModal(id) {
            permanentDeleteTargetId = id;
            const emp = (allEmployees || []).find(e => String(e.id) === String(id)) || currentViewEmployee || {};
            document.getElementById('delPermanentName').textContent = (emp.first_name || '') + ' ' + (emp.last_name || '') + ' (' + (emp.employee_id || '') + ')';
            document.getElementById('delPermanentConfirm').value = '';
            document.getElementById('delPermanentBtn').disabled = true;
            document.getElementById('deletePermanentModal').classList.add('active');
            document.getElementById('delPermanentConfirm').focus();
        }

        async function confirmPermanentDelete() {
            if (!permanentDeleteTargetId) return;
            const result = await apiCall('/employees/' + permanentDeleteTargetId + '/permanent', 'DELETE');
            if (result && result.success) {
                showToast(result.message || 'Employee permanently deleted', 'success');
                closeModal('deletePermanentModal');
                closeModal('viewEmployeeModal');
                permanentDeleteTargetId = null;
                await Promise.all([loadEmployees(), loadPendingCounts()]);
            } else {
                showToast(result?.message || 'Failed to permanently delete employee', 'error');
            }
        }

        document.addEventListener('input', function(e) {
            if (e.target && e.target.id === 'delPermanentConfirm') {
                document.getElementById('delPermanentBtn').disabled = (e.target.value.trim() !== 'DELETE');
            }
        });

        async function loadPendingCounts() {
            const data = await apiCall('/profile-updates?status=pending');
            if (data && data.success) {
                pendingCounts = {};
                (data.requests || []).forEach(r => {
                    pendingCounts[r.employee_id] = (pendingCounts[r.employee_id] || 0) + 1;
                });
            }
        }

        function maskId(value, keepChars) {
            if (!value) return '-';
            const v = String(value);
            const k = keepChars || 4;
            if (v.length <= k) return '••••';
            return '••••' + v.slice(-k);
        }

        function cap(text) { return text ? text.charAt(0).toUpperCase() + text.slice(1) : null; }

        function vRow(label, value) {
            return '<div class="detail-row"><span class="detail-label">' + escapeHtml(label) + '</span><span class="detail-value">' + (value != null && String(value) !== '' ? escapeHtml(String(value)) : '<span style="color:var(--text-tertiary);">-</span>') + '</span></div>';
        }

        function vSection(title, icon, rowsHtml) {
            return '<div class="detail-card"><h4><i class="fas ' + icon + '" style="color:var(--primary);"></i>' + escapeHtml(title) + '</h4><div class="detail-grid">' + rowsHtml + '</div></div>';
        }

        async function viewEmployee(id) {
            const [empRes, reqRes] = await Promise.all([
                apiCall(`/employees/${id}`),
                apiCall(`/profile-updates?employee_id=${id}`)
            ]);
            if (!empRes || !empRes.success) { showToast('Failed to load employee', 'error'); return; }
            const emp = empRes.employee;
            currentViewEmployee = emp;
            currentViewRequests = (reqRes && reqRes.success) ? reqRes.requests : [];

            const initials = getInitials(emp.first_name, emp.last_name);
            let avatarInner = emp.profile_photo
                ? '<img src="' + escapeHtml(emp.profile_photo) + '" alt="Profile" onerror="this.remove();">'
                : '';
            let header = '<div class="view-hero">';
            header += '<div class="avatar">' + avatarInner + escapeHtml(initials) + '</div>';
            header += '<div class="hero-info">';
            header += '<h3 style="font-weight:700;font-size:1.2rem;margin-bottom:6px;">' + escapeHtml(emp.first_name) + ' ' + escapeHtml(emp.last_name) +
                ' <span class="badge badge-' + (emp.role==='admin'?'danger':emp.role==='hr'?'warning':emp.role==='manager'?'info':emp.role==='team_lead'?'primary':'secondary') + '">' + escapeHtml(emp.role || 'employee') + '</span>' +
                ' <span class="badge badge-' + getStatusBadge(emp.status) + '">' + escapeHtml(emp.status || 'active') + '</span></h3>';
            header += '<p style="color:var(--text-secondary);font-size:0.9rem;">' + escapeHtml(emp.employee_id || '') + ' &middot; ' + escapeHtml(emp.department_name || '-') + (emp.designation_name ? ' &middot; ' + escapeHtml(emp.designation_name) + (emp.designation_level ? ' (Level ' + escapeHtml(String(emp.designation_level)) + ')' : '') : '') + '</p>';
            header += '<p style="color:var(--text-secondary);font-size:0.85rem;margin-top:4px;"><i class="fas fa-envelope" style="margin-right:6px;"></i>' + escapeHtml(emp.email || '-') + (emp.phone ? '<span style="margin-left:14px;"><i class="fas fa-phone" style="margin-right:6px;"></i>' + escapeHtml(emp.phone) + '</span>' : '') + '</p>';
            header += '</div>';
            const pend = currentViewRequests.filter(r => r.status === 'pending').length;
            header += '<div class="hero-actions">';
            if (pend > 0) header += '<span class="badge badge-warning"><i class="fas fa-hourglass-half"></i> ' + pend + ' pending update(s)</span>';
            header += '<button class="btn btn-sm btn-secondary" onclick="resetEmployeePassword(' + emp.id + ')"><i class="fas fa-key"></i> Reset Password</button>';
            if (emp.status === 'active') {
                header += '<button class="btn btn-sm btn-warning" onclick="pauseEmployee(' + emp.id + ')"><i class="fas fa-pause"></i> Pause</button>';
                header += '<button class="btn btn-sm btn-warning" onclick="openStatusModal(' + emp.id + ', \'hold\')"><i class="fas fa-circle-pause"></i> Hold</button>';
                header += '<button class="btn btn-sm btn-dark" onclick="openStatusModal(' + emp.id + ', \'abscond\')" style="background:#1f2937;border-color:#1f2937;color:#fff;"><i class="fas fa-user-slash"></i> Abscond</button>';
                header += '<button class="btn btn-sm btn-danger" onclick="openStatusModal(' + emp.id + ', \'terminate\')"><i class="fas fa-trash"></i> Terminate</button>';
            } else if (emp.status === 'paused') {
                header += '<button class="btn btn-sm btn-success" onclick="resumeEmployee(' + emp.id + ')"><i class="fas fa-play"></i> Resume</button>';
                header += '<button class="btn btn-sm btn-danger" onclick="openStatusModal(' + emp.id + ', \'terminate\')"><i class="fas fa-trash"></i> Terminate</button>';
            } else if (emp.status === 'on_hold') {
                header += '<button class="btn btn-sm btn-success" onclick="unholdEmployee(' + emp.id + ')"><i class="fas fa-play"></i> Unhold</button>';
                header += '<button class="btn btn-sm btn-danger" onclick="openStatusModal(' + emp.id + ', \'terminate\')"><i class="fas fa-trash"></i> Terminate</button>';
            } else if (emp.status === 'absconded') {
                header += '<button class="btn btn-sm btn-success" onclick="rehireEmployee(' + emp.id + ')"><i class="fas fa-undo"></i> Rejoin</button>';
                header += '<button class="btn btn-sm btn-danger" onclick="openStatusModal(' + emp.id + ', \'terminate\')"><i class="fas fa-trash"></i> Terminate</button>';
            } else if (emp.status === 'terminated') {
                header += '<button class="btn btn-sm btn-success" onclick="rehireEmployee(' + emp.id + ')"><i class="fas fa-undo"></i> Rehire (same ID)</button>';
            }
            header += '<button class="btn btn-sm btn-danger" onclick="openPermanentDeleteModal(' + emp.id + ')"><i class="fas fa-trash"></i> Delete Permanently</button>';
            header += '</div>';
            header += '</div>';
            document.getElementById('viewEmpHeader').innerHTML = header;
            document.getElementById('viewEmpTitle').textContent = 'Employee Details - ' + emp.first_name + ' ' + (emp.last_name || '');

            renderViewTabs();
            document.getElementById('viewEmployeeModal').classList.add('active');
            showViewTab('overview');
        }

        function resetEmployeePassword(id) {
            const emp = currentViewEmployee;
            showConfirmDialog('Reset Password', 'Generate a temporary password for <strong>' + escapeHtml(emp.first_name + ' ' + (emp.last_name || '')) + '</strong>? They will be required to change it on next login.', 'Reset Password', 'btn-warning', async function() {
                const data = await apiCall('/employees/' + id + '/reset-password', 'POST', {});
                if (data && data.success) {
                    showTempPasswordModal(data.temp_password);
                    await Promise.all([loadEmployees(), loadPendingCounts()]);
                } else {
                    showToast(data?.message || 'Failed to reset password', 'error');
                }
            });
        }

        function showTempPasswordModal(tempPassword) {
            const existing = document.getElementById('tempPasswordOverlay');
            if (existing) existing.remove();

            const overlay = document.createElement('div');
            overlay.id = 'tempPasswordOverlay';
            overlay.className = 'modal active';
            overlay.onclick = function(e) { if (e.target === this) { this.remove(); } };

            const content = document.createElement('div');
            content.className = 'modal-content';
            content.style.maxWidth = '420px';
            content.onclick = function(e) { e.stopPropagation(); };

            const header = document.createElement('div');
            header.className = 'modal-header';
            header.innerHTML = '<h2><i class="fas fa-key" style="color:var(--warning);margin-right:8px;"></i>Temporary Password</h2><button class="modal-close" onclick="this.closest(\'.modal\').remove()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);">&times;</button>';

            const body = document.createElement('div');
            body.className = 'modal-body';
            body.innerHTML = '<p style="line-height:1.6;">Share this temporary password with the employee. They must change it on next login.</p>' +
                '<div style="margin:16px 0;padding:14px;background:var(--border-light);border-radius:var(--radius);text-align:center;font-family:monospace;font-size:1.1rem;font-weight:700;word-break:break-all;">' + escapeHtml(tempPassword) + '</div>';

            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            footer.innerHTML = '<button class="btn btn-secondary" onclick="this.closest(\'.modal\').remove()">Close</button>';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-primary';
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
            copyBtn.onclick = function() {
                navigator.clipboard.writeText(tempPassword).then(() => showToast('Password copied', 'success'));
            };
            footer.appendChild(copyBtn);

            content.appendChild(header);
            content.appendChild(body);
            content.appendChild(footer);
            overlay.appendChild(content);
            document.body.appendChild(overlay);
        }

        function renderViewTabs() {
            const emp = currentViewEmployee;
            if (!emp) return;

            const incFields = getIncompleteFields(emp);
            let overviewHtml = '';
            if (incFields.length > 0) {
                overviewHtml += '<div style="padding:10px 12px;border-radius:var(--radius);background:#FEF3C7;border:1px solid #F59E0B;color:#92400E;font-size:0.82rem;margin-bottom:12px;line-height:1.6;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i><strong>' + incFields.length + ' personal detail(s) pending from employee:</strong> ' + incFields.map(f => '<strong>' + escapeHtml(f[1]) + '</strong>').join(', ') + '<br><span style="font-size:0.76rem;">These are filled by the employee under <strong>My Profile</strong> &mdash; remind them to log in and complete.</span></div>';
            } else {
                overviewHtml += '<p style="font-size:0.82rem;color:var(--success);margin-bottom:12px;"><i class="fas fa-check-circle"></i> All personal details provided by the employee.</p>';
            }
            document.getElementById('viewTabOverview').innerHTML = overviewHtml +
                vSection('Contact Information', 'fa-address-book', 
                    vRow('Official Email', emp.email) +
                    vRow('Personal Email', emp.personal_email) +
                    vRow('Phone', emp.phone)) +
                vSection('Personal Information', 'fa-user',
                    vRow('Date of Birth', emp.date_of_birth ? formatDate(emp.date_of_birth) : null) +
                    vRow('Gender', cap(emp.gender)) +
                    vRow('Blood Group', emp.blood_group) +
                    vRow('Marital Status', cap(emp.marital_status)) +
                    vRow('Languages Spoken', emp.languages_spoken)) +
                vSection('Employment', 'fa-briefcase',
                    vRow('Joining Date', emp.joining_date ? formatDate(emp.joining_date) : null) +
                    vRow('Status', emp.status || 'active') +
                    vRow('Status Reason', emp.status_reason) +
                    vRow('Last Working Day', emp.last_working_day ? formatDate(emp.last_working_day) : null) +
                    vRow('Department', emp.department_name) +
                    vRow('Designation', emp.designation_name ? emp.designation_name + (emp.designation_level ? ' (Level ' + emp.designation_level + ')' : '') : null) +
                    vRow('Reporting To', emp.reporting_manager_name ? emp.reporting_manager_name + (emp.reporting_manager_employee_id ? ' (' + emp.reporting_manager_employee_id + ')' : '') : null));

            document.getElementById('viewTabPersonal').innerHTML =
                vSection('Addresses', 'fa-home',
                    vRow('Current Address', emp.address) +
                    vRow('Permanent Address', emp.permanent_address)) +
                vSection('Contact', 'fa-phone',
                    vRow('Personal Email', emp.personal_email) +
                    vRow('Official Email', emp.email) +
                    vRow('Mobile', emp.phone) +
                    vRow('Emergency Contact', emp.emergency_contact_name ? emp.emergency_contact_name + ' (' + emp.emergency_contact + ')' : null)) +
                vSection('Personal Details', 'fa-user',
                    vRow('Date of Birth', emp.date_of_birth ? formatDate(emp.date_of_birth) : null) +
                    vRow('Gender', cap(emp.gender)) +
                    vRow('Blood Group', emp.blood_group) +
                    vRow('Marital Status', cap(emp.marital_status)) +
                    vRow('Languages Spoken', emp.languages_spoken));

            document.getElementById('viewTabQualifications').innerHTML =
                vSection('Education', 'fa-graduation-cap',
                    vRow('Qualification', emp.qualification) +
                    vRow('Specialization', emp.specialization)) +
                vSection('Government IDs', 'fa-id-card',
                    vRow('PAN Number', emp.pan_number) +
                    vRow('UAN Number', emp.uan_number) +
                    vRow('Aadhaar Number', emp.aadhaar_number) +
                    vRow('Passport Number', emp.passport_number));

            document.getElementById('viewTabBank').innerHTML =
                vSection('Bank Details', 'fa-university',
                    vRow('Bank Name', emp.bank_name) +
                    vRow('Branch', emp.bank_branch) +
                    vRow('Account Number', emp.bank_account) +
                    vRow('IFSC Code', emp.bank_ifsc));

            document.getElementById('viewTabJob').innerHTML =
                vSection('Job Information', 'fa-briefcase',
                    vRow('Employee ID', emp.employee_id) +
                    vRow('Department', emp.department_name) +
                    vRow('Designation', emp.designation_name ? emp.designation_name + (emp.designation_level ? ' (Level ' + emp.designation_level + ')' : '') : null) +
                    vRow('Role', emp.role) +
                    vRow('Joining Date', emp.joining_date ? formatDate(emp.joining_date) : null) +
                    vRow('Status', emp.status)) +
                vSection('Total Compensation', 'fa-indian-rupee-sign',
                    vRow('Total Compensation', emp.salary ? formatCurrency(emp.salary) : null) +
                    vRow('UAN Number', emp.uan_number)) +
                vSection('Salary Structure', 'fa-calculator',
                    vRow('Basic Salary', formatCurrency(emp.basic_salary)) +
                    vRow('HRA', formatCurrency(emp.hra)) +
                    vRow('Conveyance', formatCurrency(emp.conveyance)) +
                    vRow('Medical Allowance', formatCurrency(emp.other_allowance)) +
                    vRow('Special Allowance', formatCurrency(emp.special_allowance)) +
                    vRow('Employee PF', formatCurrency(emp.pf)) +
                    vRow('Employee ESI', formatCurrency(emp.esi)) +
                    vRow('Professional Tax', formatCurrency(emp.professional_tax)) +
                    vRow('Income Tax', formatCurrency(emp.income_tax)) +
                    vRow('Other Deduction', formatCurrency(emp.other_deduction)) +
                     vRow('Employer PF', formatCurrency(emp.employer_pf)) +
                    vRow('Employer ESI', formatCurrency(emp.employer_esi)) +
                    vRow('Employer Contribution', formatCurrency(emp.employer_contribution))) +
                vSection('System Info', 'fa-clock',
                    vRow('Created', emp.created_at ? formatDate(emp.created_at) : null) +
                    vRow('Last Updated', emp.updated_at ? formatDate(emp.updated_at) : null));

            renderRequestsTab();
        }

        function renderRequestsTab() {
            const container = document.getElementById('viewTabRequests');
            const badge = document.getElementById('viewTabRequestsBadge');
            const pendCount = (currentViewRequests || []).filter(r => r.status === 'pending').length;
            if (badge) {
                badge.style.display = pendCount > 0 ? 'inline-block' : 'none';
                badge.textContent = pendCount;
            }
            if (!currentViewRequests || currentViewRequests.length === 0) {
                container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.9rem;">No update requests from this employee.</p>';
                return;
            }            const labels = {
                address: 'Current Address', permanent_address: 'Permanent Address', languages_spoken: 'Languages Spoken',
                marital_status: 'Marital Status', personal_email: 'Personal Email', emergency_contact: 'Emergency Contact Number',
                emergency_contact_name: 'Emergency Contact Name', blood_group: 'Blood Group', qualification: 'Qualification',
                specialization: 'Specialization', pan_number: 'PAN Number', aadhaar_number: 'Aadhaar Number',
                passport_number: 'Passport Number', bank_name: 'Bank Name', bank_branch: 'Bank Branch',
                bank_account: 'Bank Account No', bank_ifsc: 'IFSC Code'
            };
            const badgeMap = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'secondary' };
            const order = ['pending', 'approved', 'rejected', 'cancelled'];
            const groupTitles = { pending: 'Pending (awaiting approval)', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
            let html = '';
            order.forEach(status => {
                const group = currentViewRequests.filter(r => r.status === status);
                if (group.length === 0) return;
                html += '<div class="req-section-title">' + escapeHtml(groupTitles[status]) + ' (' + group.length + ')</div>';
                html += '<div class="table-container"><table><thead><tr><th>Field</th><th>Old Value</th><th>New Value</th><th>Submitted</th><th>Reviewed By</th><th>Remarks</th><th>Action</th></tr></thead><tbody>';
                group.forEach(r => {
                    html += '<tr>';
                    html += '<td><strong>' + escapeHtml(labels[r.field] || r.field) + '</strong></td>';
                    html += '<td>' + escapeHtml(r.old_value || '-') + '</td>';
                    html += '<td><strong>' + escapeHtml(r.new_value || '-') + '</strong></td>';
                    html += '<td style="font-size:0.8rem;">' + formatDate(r.created_at) + '</td>';
                    html += '<td style="font-size:0.8rem;">' + escapeHtml(r.reviewer_name || '-') + '</td>';
                    html += '<td style="font-size:0.8rem;">' + escapeHtml(r.review_remarks || '-') + '</td>';
                    html += '<td>';
                    if (r.status === 'pending') {
                        html += '<div style="display:flex;gap:4px;">';
                        html += '<button class="btn btn-sm btn-success" onclick="approveRequest(' + r.id + ')"><i class="fas fa-check"></i> Approve</button>';
                        html += '<button class="btn btn-sm btn-danger" onclick="openRejectModal(' + r.id + ')"><i class="fas fa-times"></i> Reject</button>';
                        html += '</div>';
                    } else {
                        html += '<span class="badge badge-' + (badgeMap[r.status] || 'secondary') + '">' + escapeHtml(r.status) + '</span>';
                    }
                    html += '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
            });
            container.innerHTML = html;
        }

        let currentViewTab = 'overview';
        function showViewTab(tab) {
            currentViewTab = tab;
            const tabs = ['overview', 'personal', 'qualifications', 'bank', 'job', 'requests'];
            tabs.forEach(t => {
                const el = document.getElementById('viewTab' + t.charAt(0).toUpperCase() + t.slice(1));
                if (el) el.style.display = t === tab ? 'block' : 'none';
                const btn = document.querySelector('[data-tab="' + t + '"]');
                if (btn) btn.className = 'btn btn-sm ' + (t === tab ? 'btn-primary' : 'btn-secondary');
            });
        }

        async function approveRequest(id) {
            const result = await apiCall('/profile-updates/' + id + '/approve', 'POST');
            if (result && result.success) {
                showToast(result.message || 'Request approved', 'success');
                const restoreTab = currentViewTab === 'requests' ? 'requests' : 'overview';
                await Promise.all([viewEmployee(currentViewEmployee.id), loadPendingCounts(), loadEmployees()]);
                renderEmployees(allEmployees);
                showViewTab(restoreTab);
                loadNotifBadge();
            } else {
                showToast(result?.message || 'Failed to approve', 'error');
            }
        }

        let rejectTargetId = null;
        function openRejectModal(id) {
            rejectTargetId = id;
            document.getElementById('rejectRemarks').value = '';
            document.getElementById('rejectModal').classList.add('active');
        }

        async function confirmReject() {
            const remarks = document.getElementById('rejectRemarks').value;
            const result = await apiCall('/profile-updates/' + rejectTargetId + '/reject', 'POST', { remarks });
            if (result && result.success) {
                showToast('Request rejected', 'success');
                closeModal('rejectModal');
                const restoreTab = currentViewTab === 'requests' ? 'requests' : 'overview';
                await Promise.all([viewEmployee(currentViewEmployee.id), loadPendingCounts(), loadEmployees()]);
                renderEmployees(allEmployees);
                showViewTab(restoreTab);
                loadNotifBadge();
            } else {
                showToast(result?.message || 'Failed to reject', 'error');
            }
        }

        // ---------- Letters (experience / employment PDF) ----------
        let letterType = 'experience';

        function openLetterModal(type) {
            letterType = type || 'experience';
            if (!currentViewEmployee) { showToast('Open an employee first', 'error'); return; }
            document.getElementById('letterModalTitle').textContent = (letterType === 'employment' ? 'Employment' : 'Experience') + ' Letter';
            document.getElementById('letterEmpInfo').innerHTML =
                '<strong>' + escapeHtml((currentViewEmployee.first_name || '') + ' ' + (currentViewEmployee.last_name || '')) + '</strong> (' + escapeHtml(currentViewEmployee.employee_id || '') + ')';
            document.getElementById('letterLwdGroup').style.display = letterType === 'employment' ? 'none' : 'block';
            document.getElementById('letterLwd').value = '';
            document.getElementById('letterSignatory').value = '';
            document.getElementById('letterModal').classList.add('active');
        }

        async function generateLetter() {
            if (!currentViewEmployee) return;
            const btn = document.getElementById('letterGenerateBtn');
            if (btn.disabled) return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`${API_URL}/letters/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        employee_id: currentViewEmployee.id,
                        letter_type: letterType,
                        last_working_date: document.getElementById('letterLwd').value || undefined,
                        signatory_name: document.getElementById('letterSignatory').value.trim() || undefined
                    })
                });
                if (response.status === 401) { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = getLoginUrl(getCurrentUser()); return; }
                if (!response.ok) {
                    let msg = 'Letter generation failed';
                    try { const j = await response.json(); if (j.message) msg = j.message; } catch (_) {}
                    showToast(msg, 'error');
                    return;
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = letterType + '_letter_' + (currentViewEmployee.employee_id || '') + '.pdf';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                closeModal('letterModal');
                showToast('Letter downloaded!', 'success');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-file-pdf"></i> Download PDF';
            }
        }

        // ---------- CSV bulk import ----------
        let csvRows = null;

        const CSV_COLUMNS = ['employee_id', 'first_name', 'last_name', 'email', 'phone',
            'department_id', 'designation_id', 'joining_date', 'salary', 'role',
            'date_of_birth', 'gender', 'personal_email', 'blood_group', 'marital_status',
            'bank_name', 'bank_branch', 'bank_account', 'bank_ifsc',
            'pan_number', 'aadhaar_number', 'uan_number', 'pf_number', 'esi_number'];
        const CSV_REQUIRED = ['employee_id', 'first_name', 'last_name', 'email'];

        function openImportModal() {
            document.getElementById('csvFile').value = '';
            document.getElementById('csvPreviewWrap').style.display = 'none';
            document.getElementById('csvSummary').style.display = 'none';
            document.getElementById('csvImportBtn').disabled = true;
            csvRows = null;
            document.getElementById('importModal').classList.add('active');
        }

        function downloadCsvTemplate() {
            const rows = [CSV_COLUMNS, ['EMP010', 'Ravi', 'Kumar', 'ravi@example.com', '9876543210', '', '', '2025-01-15', '30000', 'employee']];
            const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'employee_import_template.csv';
            a.click();
            URL.revokeObjectURL(a.href);
        }

        // Minimal RFC-4180-ish CSV parser: handles quoted fields and escaped quotes.
        function parseCsv(text) {            const rows = [];
            let row = [], field = '', inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (inQuotes) {
                    if (ch === '"') {
                        if (text[i + 1] === '"') { field += '"'; i++; }
                        else inQuotes = false;
                    } else field += ch;
                } else if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    row.push(field); field = '';
                } else if (ch === '\n' || ch === '\r') {
                    if (ch === '\r' && text[i + 1] === '\n') i++;
                    row.push(field); field = '';
                    if (row.some(c => c.trim() !== '')) rows.push(row);
                    row = [];
                } else field += ch;
            }
            row.push(field);
            if (row.some(c => c.trim() !== '')) rows.push(row);
            return rows;
        }

        function previewCsv() {
            const input = document.getElementById('csvFile');
            if (!input.files || !input.files[0]) return;
            const reader = new FileReader();
            reader.onload = () => {
                try { handleCsvText(String(reader.result)); }
                catch (e) { showToast('Could not read the file: ' + e.message, 'error'); }
            };
            reader.readAsText(input.files[0]);
        }

        function handleCsvText(text) {
            const parsed = parseCsv(text.replace(/^\uFEFF/, ''));
            if (parsed.length < 2) { showToast('CSV needs a header row plus at least one data row', 'error'); return; }
            const headers = parsed[0].map(h => h.trim().toLowerCase());
            const missing = CSV_REQUIRED.filter(r => !headers.includes(r));
            if (missing.length > 0) { showToast('Missing required column(s): ' + missing.join(', '), 'error'); return; }
            if (parsed.length - 1 > 500) { showToast('Maximum 500 rows per import. Split the file.', 'error'); return; }

            csvRows = parsed.slice(1).map(cells => {
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = cells[idx] !== undefined ? cells[idx].trim() : ''; });
                return obj;
            });

            // Preview first 5 rows
            document.getElementById('csvPreviewHead').innerHTML =
                '<th>Row</th>' + CSV_REQUIRED.map(h => '<th>' + escapeHtml(h) + '</th>').join('');
            document.getElementById('csvPreviewBody').innerHTML =
                csvRows.slice(0, 5).map((r, i) => {
                    const bad = CSV_REQUIRED.some(h => !r[h]);
                    return '<tr' + (bad ? ' style="background:var(--danger-light,#FEE2E2);"' : '') + '>' +
                        '<td>' + (i + 1) + '</td>' +
                        CSV_REQUIRED.map(h => '<td>' + escapeHtml(r[h] || '') + '</td>').join('') +
                    '</tr>';
                }).join('') +
                (csvRows.length > 5 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);">...and ' + (csvRows.length - 5) + ' more rows</td></tr>' : '');
            document.getElementById('csvPreviewWrap').style.display = 'block';

            const invalidCount = csvRows.filter(r => CSV_REQUIRED.some(h => !r[h])).length;
            const summary = document.getElementById('csvSummary');
            summary.style.display = 'block';
            summary.textContent = csvRows.length + ' row(s) found' + (invalidCount ? ', ' + invalidCount + ' with missing required fields (they will be skipped by the server)' : '');
            summary.style.color = invalidCount ? 'var(--warning, #B45309)' : 'var(--success, #059669)';

            document.getElementById('csvImportBtn').disabled = false;
        }

        async function runImport() {
            if (!csvRows || csvRows.length === 0) return;
            const btn = document.getElementById('csvImportBtn');
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';

            const result = await apiCall('/employees/import', 'POST', { items: csvRows });

            btn.innerHTML = '<i class="fas fa-file-import"></i> Import';
            if (result && result.success) {
                showToast(result.created + ' employee(s) created' + (result.failed ? ', ' + result.failed + ' failed' : ''), result.failed ? 'warning' : 'success');
                closeModal('importModal');
                await Promise.all([loadEmployees(), loadPendingCounts()]);
                if (result.results && result.results.length <= 20) {
                    result.results.filter(r => !r.ok).forEach(r =>
                        showToast('Row ' + r.row + ': ' + (r.error || 'failed'), 'error'));
                }
                // Show temp passwords for created accounts so admin can share them.
                const createdRows = (result.results || []).filter(r => r.ok);
                if (createdRows.length > 0 && createdRows.length <= 10) {
                    showConfirmDialog(
                        'Import Complete — Temp Passwords',
                        'Save these now, they are shown only once:\n\n' +
                        createdRows.map(r => r.employee_id + ': ' + r.temp_password).join('\n'),
                        'Got it', 'btn-primary'
                    );
                } else if (createdRows.length > 10) {
                    showToast(createdRows.length + ' accounts created. Temp passwords were random - use Reset Password to reissue.', 'info');
                }
            } else {
                showToast((result && result.message) || 'Import failed', 'error');
                btn.disabled = false;
            }
        }