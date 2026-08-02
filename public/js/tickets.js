(function () {
    function injectTicketUI() {
        if (document.getElementById('ticketBtn')) return;

        const style = document.createElement('style');
        style.textContent = `
            #ticketBtn {
                position: fixed;
                right: 24px;
                bottom: 24px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: var(--primary);
                color: white;
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.3rem;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
                z-index: 1500;
                transition: transform 0.2s ease, background 0.2s ease;
            }
            #ticketBtn:hover { transform: scale(1.08); background: var(--primary-dark); }
            #ticketBtn .tooltip {
                position: absolute;
                right: 68px;
                top: 50%;
                transform: translateY(-50%);
                background: var(--text-primary);
                color: var(--card-bg);
                padding: 5px 10px;
                border-radius: 6px;
                font-size: 0.8rem;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            #ticketBtn:hover .tooltip { opacity: 1; }
            .dark-mode #ticketBtn { box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5); }
        `;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.id = 'ticketBtn';
        btn.title = 'Raise a query';
        btn.setAttribute('onclick', 'openTicketModal()');
        btn.innerHTML = '<i class="fas fa-ticket-alt"></i><span class="tooltip">Raise a Query</span>';
        document.body.appendChild(btn);

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'ticketModal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-ticket-alt" style="color:var(--primary);margin-right:8px;"></i>Raise a Query</h2>
                    <button onclick="closeTicketModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="ticketForm" onsubmit="submitTicket(event)">
                        <div class="form-group">
                            <label>Category *</label>
                            <select class="form-control" id="ticketCategory" required>
                                <option value="">Select category</option>
                                <option value="Attendance">Attendance</option>
                                <option value="Payroll & Salary">Payroll & Salary</option>
                                <option value="Leave & WFH">Leave & WFH</option>
                                <option value="Profile Details">Profile Details</option>
                                <option value="Documents">Documents</option>
                                <option value="Technical Issue">Technical Issue</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Subject *</label>
                            <input type="text" class="form-control" id="ticketSubject" required maxlength="255" placeholder="Brief title of your query">
                        </div>
                        <div class="form-group">
                            <label>Description</label>
                            <textarea class="form-control" id="ticketDescription" rows="4" placeholder="Describe your query in detail"></textarea>
                        </div>
                        <div class="form-group">
                            <label>Priority</label>
                            <select class="form-control" id="ticketPriority">
                                <option value="low">Low</option>
                                <option value="medium" selected>Medium</option>
                                <option value="high">High</option>
                            </select>
                        </div>
                        <div class="modal-footer" style="padding:0;border:none;margin-top:8px;">
                            <button type="button" class="btn btn-secondary" onclick="closeTicketModal()">Cancel</button>
                            <button type="submit" class="btn btn-primary" id="ticketSubmitBtn"><i class="fas fa-paper-plane"></i> Submit Query</button>
                        </div>
                    </form>
                    <div style="text-align:center;margin-top:14px;">
                        <a href="/pages/employee/tickets.html" style="color:var(--primary);font-size:0.9rem;text-decoration:none;"><i class="fas fa-history"></i> View My Queries</a>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }

    document.addEventListener('DOMContentLoaded', injectTicketUI);
})();

function openTicketModal() {
    const modal = document.getElementById('ticketModal');
    if (!modal) return;
    document.getElementById('ticketForm').reset();
    document.getElementById('ticketPriority').value = 'medium';
    modal.classList.add('active');
}

function closeTicketModal() {
    const modal = document.getElementById('ticketModal');
    if (modal) modal.classList.remove('active');
}

async function submitTicket(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('ticketSubmitBtn');
    const original = submitBtn.innerHTML;

    const category = document.getElementById('ticketCategory').value;
    const subject = document.getElementById('ticketSubject').value.trim();
    const description = document.getElementById('ticketDescription').value.trim();
    const priority = document.getElementById('ticketPriority').value;

    if (!category || !subject) {
        showToast('Please fill all required fields', 'error');
        return;
    }

    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    submitBtn.disabled = true;

    const data = await apiCall('/tickets', 'POST', {
        category: category,
        subject: subject,
        description: description,
        priority: priority
    });

    if (data && data.success) {
        showToast('Query submitted successfully!', 'success');
        closeTicketModal();
    } else {
        showToast(data?.message || 'Failed to submit query', 'error');
    }

    submitBtn.innerHTML = original;
    submitBtn.disabled = false;
}
