const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your-email@gmail.com') {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        return transporter;
    }
    return null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Shared branded shell so every outgoing mail looks consistent and
// professional across Gmail / Outlook / Apple Mail.
function baseEmail({ preheader, headerTitle, bodyHtml }) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
        <tr><td align="center">
            <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.08);">
                <tr>
                    <td style="background:linear-gradient(135deg,#4F46E5 0%,#9333EA 100%);padding:26px 32px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                            <td style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Gensar<span style="font-weight:400;">&nbsp;HRMS</span></td>
                            <td align="right" style="font-size:11px;font-weight:600;color:#ffffff;background:rgba(255,255,255,0.18);padding:4px 12px;border-radius:20px;">${headerTitle}</td>
                        </tr></table>
                    </td>
                </tr>
                <tr><td style="padding:30px 32px 26px;font-size:14px;line-height:1.7;color:#374151;">${bodyHtml}</td></tr>
                <tr>
                    <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 32px;text-align:center;">
                        <div style="font-size:12px;font-weight:600;color:#111827;">${'Gensar IT Solutions'}</div>
                        <div style="font-size:11px;color:#9CA3AF;margin-top:3px;">Human Resource Management System</div>
                        <div style="font-size:10px;color:#c2c7cf;margin-top:8px;">This is an automated message. Please do not reply directly to this email.</div>
                    </td>
                </tr>
            </table>
        </td></tr>
    </table>
</body>
</html>`;
}

// Derive "Month Year" from filenames like payslip_EMP003_8_2026.pdf
function periodFromFilename(filename) {
    try {
        const m = filename.replace(/^payslip_/, '').replace(/\.pdf$/i, '').split('_');
        const month = parseInt(m[1], 10);
        const year = m[2];
        if (month >= 1 && month <= 12 && /^\d{4}$/.test(year || '')) {
            return `${MONTHS[month - 1]} ${year}`;
        }
    } catch (e) { /* fall through */ }
    return null;
}

// Send a payslip PDF as an email attachment. Returns { success, reason } so
// callers can report a clean message when mail is not configured.
async function sendPayslipEmail(email, filename, pdfBuffer) {
    const mailTransporter = getTransporter();
    if (!mailTransporter) {
        return { success: false, reason: 'Email service not configured. Set SMTP_USER / SMTP_PASS in .env' };
    }
    const period = periodFromFilename(filename) || 'this month';
    const subject = `Payslip for ${period} - Gensar HRMS`;
    const html = baseEmail({
        preheader: `Your salary payslip for ${period} is attached.`,
        headerTitle: 'PAYSLIP',
        bodyHtml: `
            <p style="margin:0 0 14px;">Hello,</p>
            <p style="margin:0 0 18px;">Your salary payslip for <strong>${period}</strong> is ready and attached to this email as a PDF document.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ff;border-left:4px solid #4F46E5;border-radius:6px;margin-bottom:20px;"><tr>
                <td style="padding:12px 16px;font-size:13px;color:#3730a3;"><strong>&#128206; Attachment:</strong> ${filename.replace(/_/g, ' ')}</td>
            </tr></table>
            <p style="margin:0 0 6px;font-size:13px;color:#6B7280;">Please review the details carefully. If you notice any discrepancy in your attendance, earnings or deductions, reach out to the HR / Payroll team so we can correct it promptly.</p>
            <p style="margin:22px 0 0;">Best regards,<br><strong>Gensar HRMS &ndash; Payroll Team</strong></p>
        `
    });
    const text = `Hello,\n\nYour salary payslip for ${period} is attached as a PDF (${filename}).\n\nPlease review the details. For any discrepancy contact the HR / Payroll team.\n\nBest regards,\nGensar HRMS - Payroll Team\nGensar IT Solutions`;
    try {
        await mailTransporter.sendMail({
            from: `"Gensar HRMS" <${process.env.SMTP_USER}>`,
            to: email,
            subject,
            text,
            html,
            attachments: [{
                filename,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });
        return { success: true, to: email };
    } catch (error) {
        console.error('Failed to send payslip email:', error.message);
        return { success: false, reason: error.message };
    }
}

async function sendOTPEmail(email, otp) {
    const mailTransporter = getTransporter();
    if (!mailTransporter) {
        console.log(`[DEV] OTP for ${email}: ${otp}`);
        return true;
    }
    const subject = `Your Gensar HRMS verification code: ${otp}`;
    const html = baseEmail({
        preheader: `Use code ${otp} to reset your password. Valid for 5 minutes.`,
        headerTitle: 'SECURITY CODE',
        bodyHtml: `
            <p style="margin:0 0 14px;">Hello,</p>
            <p style="margin:0 0 20px;">We received a request to reset the password for your Gensar HRMS account (<strong>${email}</strong>). Use the one-time verification code below to continue.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
                <td align="center" style="padding:20px;background:#eef2ff;border:1px dashed #4F46E5;border-radius:10px;">
                    <span style="font-size:36px;font-weight:700;color:#4F46E5;letter-spacing:12px;font-family:'Consolas','Courier New',monospace;">${otp}</span>
                </td>
            </tr></table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#374151;margin-bottom:20px;">
                <tr><td style="padding:6px 0;color:#6B7280;">&#9202;&nbsp; Expires in</td><td align="right" style="font-weight:600;">5 minutes</td></tr>
                <tr><td style="padding:6px 0;color:#6B7280;">&#9993;&nbsp; Requested for</td><td align="right" style="font-weight:600;">${email}</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;"><tr>
                <td style="padding:12px 16px;font-size:12px;color:#92400e;"><strong>Security note:</strong> Never share this code with anyone. If you did not request a password reset, you can safely ignore this email &mdash; your current password will remain unchanged.</td>
            </tr></table>
            <p style="margin:22px 0 0;">Best regards,<br><strong>Gensar HRMS &ndash; Security Team</strong></p>
        `
    });
    const text = `Hello,\n\nWe received a request to reset your Gensar HRMS password.\n\nVerification code: ${otp}\nExpires in: 5 minutes\n\nNever share this code with anyone. If you did not request a reset, ignore this email - your password will remain unchanged.\n\nBest regards,\nGensar HRMS - Security Team\nGensar IT Solutions`;
    try {
        await mailTransporter.sendMail({
            from: `"Gensar HRMS" <${process.env.SMTP_USER}>`,
            to: email,
            subject,
            text,
            html
        });
        console.log(`OTP email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('Failed to send email:', error.message);
        console.log(`OTP for ${email}: ${otp} (fallback - email failed)`);
        return false;
    }
}

module.exports = { sendOTPEmail, sendPayslipEmail };
