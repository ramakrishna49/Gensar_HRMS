// Forgot-password multi-step flow for the login pages.
// Depends on showToast()/apiCall() from js/auth.js (loaded before this file).
(function () {
    function ensureModal() {
        if (document.getElementById('forgotPasswordModal')) return;

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.id = 'forgotPasswordModal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h2><i class="fas fa-key" style="color:var(--primary);margin-right:8px;"></i>Reset Password</h2>
                    <button onclick="closeForgotPassword()" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-secondary);">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="fpStep1">
                        <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:14px;">Enter your Employee ID or email. We will send a 6-digit code that is valid for 5 minutes.</p>
                        <div class="form-group">
                            <label>Employee ID or Email</label>
                            <div class="input-icon forgot-step">
                                <i class="fas fa-id-badge"></i>
                                <input type="text" class="form-control" id="fpIdentifier" placeholder="e.g. EMP002 or you@company.com" autocomplete="username">
                            </div>
                        </div>
                        <button type="button" class="btn btn-primary btn-lg" style="width:100%;" id="fpSendBtn" onclick="fpSendCode()">
                            <i class="fas fa-paper-plane"></i> Send Code
                        </button>
                    </div>

                    <div id="fpStep2" style="display:none;">
                        <p style="color:var(--text-secondary);font-size:0.88rem;margin-bottom:14px;">Enter the code we emailed you, then choose a new password.</p>
                        <div class="form-group">
                            <label>6-digit Code</label>
                            <div class="input-icon">
                                <i class="fas fa-shield-halved"></i>
                                <input type="text" class="form-control" id="fpOtp" placeholder="000000" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="letter-spacing:6px;font-weight:700;">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>New Password</label>
                            <div class="input-icon forgot-step">
                                <i class="fas fa-lock"></i>
                                <input type="password" class="form-control" id="fpNewPassword" placeholder="At least 6 characters" autocomplete="new-password">
                                <button type="button" class="password-toggle" onclick="toggleFpPassword('fpNewPassword', this)">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Confirm New Password</label>
                            <div class="input-icon forgot-step">
                                <i class="fas fa-lock"></i>
                                <input type="password" class="form-control" id="fpConfirmPassword" placeholder="Re-enter new password" autocomplete="new-password">
                                <button type="button" class="password-toggle" onclick="toggleFpPassword('fpConfirmPassword', this)">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <button type="button" class="btn btn-success btn-lg" style="width:100%;" id="fpResetBtn" onclick="fpDoReset()">
                            <i class="fas fa-check"></i> Reset Password
                        </button>
                        <button type="button" class="btn btn-secondary" style="width:100%;margin-top:8px;" onclick="fpResendCode()" id="fpResendBtn">
                            <i class="fas fa-rotate-right"></i> Resend Code
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    window.toggleFpPassword = function (inputId, btn) {
        const input = document.getElementById(inputId);
        const icon = btn.querySelector('i');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        icon.classList.toggle('fa-eye', !show);
        icon.classList.toggle('fa-eye-slash', show);
    };

    window.openForgotPassword = function () {
        ensureModal();
        document.getElementById('fpStep1').style.display = 'block';
        document.getElementById('fpStep2').style.display = 'none';
        document.getElementById('fpIdentifier').value = '';
        ['fpOtp', 'fpNewPassword', 'fpConfirmPassword'].forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('forgotPasswordModal').classList.add('active');
    };

    window.closeForgotPassword = function () {
        document.getElementById('forgotPasswordModal').classList.remove('active');
    };

    async function sendCode() {
        const identifier = document.getElementById('fpIdentifier').value.trim();
        if (!identifier) { showToast('Please enter your Employee ID or email', 'error'); return false; }

        const btn = document.getElementById('fpSendBtn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

        // The API answers generically on purpose - relay its message as-is.
        const data = await apiCall('/auth/forgot-password', 'POST', { employee_id: identifier });

        btn.disabled = false;
        btn.innerHTML = original;

        if (data && data.success) {
            showToast(data.message || 'Reset code sent to your registered email.', 'success');
            return true;
        }
        showToast((data && data.message) || 'Invalid Employee ID or Email', 'error');
        return false;
    }

    window.fpSendCode = async function () {
        if (await sendCode()) {
            document.getElementById('fpStep1').style.display = 'none';
            document.getElementById('fpStep2').style.display = 'block';
            document.getElementById('fpOtp').focus();
        }
    };

    window.fpResendCode = function () { sendCode(); };

    window.fpDoReset = async function () {
        const identifier = document.getElementById('fpIdentifier').value.trim();
        const otp = document.getElementById('fpOtp').value.trim();
        const newPassword = document.getElementById('fpNewPassword').value;
        const confirmPassword = document.getElementById('fpConfirmPassword').value;

        if (!otp || otp.length !== 6) { showToast('Enter the 6-digit code from your email', 'error'); return; }
        if (!newPassword || newPassword.length < 6) { showToast('New password must be at least 6 characters', 'error'); return; }
        if (newPassword !== confirmPassword) { showToast('Passwords do not match', 'error'); return; }

        const btn = document.getElementById('fpResetBtn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';

        const data = await apiCall('/auth/reset-password', 'POST', {
            employee_id: identifier,
            otp,
            new_password: newPassword
        });

        btn.disabled = false;
        btn.innerHTML = original;

        if (data && data.success) {
            closeForgotPassword();
            showToast(data.message || 'Password reset successful!', 'success');
        } else {
            showToast((data && data.message) || 'Invalid or expired code', 'error');
        }
    };
})();
