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

// Send a payslip PDF as an email attachment. Returns { success, reason } so
// callers can report a clean message when mail is not configured.
async function sendPayslipEmail(email, filename, pdfBuffer) {
    const mailTransporter = getTransporter();
    if (!mailTransporter) {
        return { success: false, reason: 'Email service not configured. Set SMTP_USER / SMTP_PASS in .env' };
    }
    try {
        await mailTransporter.sendMail({
            from: `"Gensar HRMS" <${process.env.SMTP_USER}>`,
            to: email,
            subject: `Your Payslip - ${filename.replace(/^payslip_/, '').replace(/\.[^.]+$/, '')}`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
                    <div style="text-align:center;margin-bottom:24px;">
                        <h2 style="color:#6E59A5;margin:0;">Gensar HRMS</h2>
                        <p style="color:#6B7280;font-size:14px;">Your Salary Payslip</p>
                    </div>
                    <p style="font-size:14px;color:#374151;">Please find your payslip attached to this email.</p>
                    <p style="font-size:12px;color:#9CA3AF;">For any queries, please contact your HR department.</p>
                    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
                    <p style="font-size:11px;color:#9CA3AF;text-align:center;">Gensar IT Solutions - Human Resource Management System</p>
                </div>
            `,
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
    if (mailTransporter) {
        try {
            await mailTransporter.sendMail({
                from: `"Gensar HRMS" <${process.env.SMTP_USER}>`,
                to: email,
                subject: 'Password Reset OTP - Gensar HRMS',
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
                        <div style="text-align:center;margin-bottom:24px;">
                            <h2 style="color:#4F46E5;margin:0;">Gensar HRMS</h2>
                            <p style="color:#6B7280;font-size:14px;">Password Reset Request</p>
                        </div>
                        <p style="font-size:14px;color:#374151;">Your OTP for password reset is:</p>
                        <div style="text-align:center;padding:16px;margin:16px 0;background:#EEF2FF;border-radius:8px;">
                            <span style="font-size:32px;font-weight:700;color:#4F46E5;letter-spacing:8px;">${otp}</span>
                        </div>
                        <p style="font-size:12px;color:#9CA3AF;">This OTP is valid for 5 minutes. If you did not request this, please ignore this email.</p>
                        <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
                        <p style="font-size:11px;color:#9CA3AF;text-align:center;">Gensar IT Solutions - Human Resource Management System</p>
                    </div>
                `
            });
            console.log(`OTP email sent to ${email}`);
            return true;
        } catch (error) {
            console.error('Failed to send email:', error.message);
            console.log(`OTP for ${email}: ${otp} (fallback - email failed)`);
            return false;
        }
    } else {
        console.log(`[DEV] OTP for ${email}: ${otp}`);
        return true;
    }
}

module.exports = { sendOTPEmail, sendPayslipEmail };