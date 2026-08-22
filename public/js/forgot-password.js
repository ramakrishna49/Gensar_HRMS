// Forgot-password multi-step flow for the login pages.
// Depends on showToast()/apiCall() from js/auth.js (loaded before this file).
//
// Flow:
//   Step 1 - identifier            -> POST /auth/forgot-password
//   Step 2a - OTP only             -> POST /auth/verify-reset-otp (no consume)
//   Step 2b - new + confirm pass   -> POST /auth/reset-password  (consumes code)
(function () {
    const lblIcon = 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--text);';
    const lblIconStyle = 'color:var(--primary);font-size:0.95rem;width:18px;text-align:center;';

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
                            <label style="${lblIcon}"><i class="fas fa-id-badge" style="${lblIconStyle}"></i>Employee ID / Email</label>
                            <input type="text" class="form-control" id="fpIdentifier" placeholder="e.g. EMP002 or you@company.com" autocomplete="username" style="margin-top:6px;">
                        </div>
                        <button type="button" class="btn btn-primary btn-lg" style="width:100%;" id="fpSendBtn" onclick="fpSendCode()">
                            <i class="fas fa-paper-plane"></i> Send Code
                        </button>
                    </div>

                    <div id="fpStep2" style="display:none;">
                        <div id="fpStepOtp">
                            <div class="form-group">
                                <label style="${lblIcon}"><i class="fas fa-shield-halved" style="${lblIconStyle}"></i>6-digit Code</label>
                                <input type="text" class="form-control" id="fpOtp" placeholder="000000" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="margin-top:6px;letter-spacing:6px;font-weight:700;text-align:center;font-size:1.15rem;">
                            </div>
                            <button type="button" class="btn btn-primary btn-lg" style="width:100%;" id="fpVerifyBtn" onclick="fpVerifyCode()">
                                <i class="fas fa-circle-check"></i> Verify Code
                            </button>
                            <button type="button" class="btn btn-secondary" style="width:100%;margin-top:8px;" onclick="fpResendCode()" id="fpResendBtn">
                                <i class="fas fa-rotate-right"></i> Resend Code
                            </button>
                        </div>

                        <div id="fpStepPassword" style="display:none;">
                            <p style="color:#059669;font-size:0.88rem;margin:-4px 0 14px;"><i class="fas fa-circle-check" style="margin-right:6px;"></i>Code verified! Now set your new password.</p>
                            <div class="form-group">
                                <label style="${lblIcon}"><i class="fas fa-lock" style="${lblIconStyle}"></i>New Password</label>
                                <div style="position:relative;margin-top:6px;">
                                    <input type="password" class="form-control" id="fpNewPassword" placeholder="At least 6 characters" autocomplete="new-password" style="padding-right:42px;">
                                    <button type="button" class="password-toggle" onclick="toggleFpPassword('fpNewPassword', this)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-secondary);">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label style="${lblIcon}"><i class="fas fa-lock" style="${lblIconStyle}"></i>Confirm New Password</label>
                                <div style="position:relative;margin-top:6px;">
                                    <input type="password" class="form-control" id="fpConfirmPassword" placeholder="Re-enter new password" autocomplete="new-password" style="padding-right:42px;">
                                    <button type="button" class="password-toggle" onclick="toggleFpPassword('fpConfirmPassword', this)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-secondary);">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                </div>
                            </div>
                            <button type="button" class="btn btn-success btn-lg" style="width:100%;" id="fpResetBtn" onclick="fpDoReset()">
                                <i class="fas fa-check"></i> Reset Password
                            </button>
                        </div>
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
        document.getElementById('fpStepOtp').style.display = 'block';
        document.getElementById('fpStepPassword').style.display = 'none';
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

        const btn = document.getElementById('fpSendBtn') || document.getElementById('fpResendBtn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

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
            document.getElementById('fpStepOtp').style.display = 'block';
            document.getElementById('fpStepPassword').style.display = 'none';
            document.getElementById('fpOtp').focus();
        }
    };

    window.fpResendCode = function () { sendCode(); };

    // Verify the OTP first WITHOUT consuming it. Only after success are the
    // password fields revealed.
    window.fpVerifyCode = async function () {
        const identifier = document.getElementById('fpIdentifier').value.trim();
        const otp = document.getElementById('fpOtp').value.trim();
        if (!otp || otp.length !== 6) { showToast('Enter the 6-digit code from your email', 'error'); return; }

        const btn = document.getElementById('fpVerifyBtn');
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';

        const data = await apiCall('/auth/verify-reset-otp', 'POST', { employee_id: identifier, otp });

        btn.disabled = false;
        btn.innerHTML = original;

        if (data && data.success) {
            showToast(data.message || 'Code verified!', 'success');
            document.getElementById('fpStepOtp').style.display = 'none';
            document.getElementById('fpStepPassword').style.display = 'block';
            document.getElementById('fpNewPassword').focus();
        } else {
            showToast((data && data.message) || 'Invalid or expired code', 'error');
        }
    };

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
