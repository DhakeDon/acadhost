'use strict';

// ============================================================
// Email Service — services/emailService.js
// Section 11
//
// Sole file in the codebase that sends emails.
// Uses nodemailer with Gmail SMTP (App Password / STARTTLS).
//
// Key behaviours:
//   - Transporter created once at module load; reused for all sends.
//   - SMTP verify() called at module load — failure is non-fatal
//     (logged as warning, does not crash the server).
//   - In-memory dailySendCount enforces SMTP_DAILY_LIMIT.
//   - Counter resets to 0 every 24 h via setInterval.
//   - Email failures are non-blocking for callers; all exported
//     functions may throw EMAIL_LIMIT_REACHED or EMAIL_SEND_FAILED
//     but callers must catch and handle without halting their
//     primary operation.
//   - Every send includes both html: and text: (plaintext fallback).
// ============================================================

const nodemailer = require('nodemailer');

// ── Transporter ──────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

transporter.verify()
    .then(() => {
      console.log('[emailService] SMTP connection verified successfully.');
    })
    .catch((err) => {
      console.warn(`[emailService] SMTP verification failed (non-fatal): ${err.message}`);
    });

// ── Daily send limit ─────────────────────────────────────────

let dailySendCount = 0;

setInterval(() => {
  dailySendCount = 0;
}, 24 * 60 * 60 * 1000);

// ── Shared HTML base template ─────────────────────────────────
//
// All transactional emails share this wrapper for visual consistency.
// It uses a single system-safe font stack (no Google Fonts import needed
// in email clients) and a clean two-tone layout that renders well in
// Gmail, Outlook, Apple Mail, and dark-mode clients.
//
// Parameters:
//   accentColor  — hex string used for the header bar and CTA button
//   icon         — a short emoji or unicode symbol shown in the header
//   heading      — bold heading text (keep under ~40 chars)
//   bodyHtml     — inner HTML for the message body (paragraphs, tables, etc.)
//   ctaHref      — optional CTA button URL
//   ctaLabel     — optional CTA button label text
// ─────────────────────────────────────────────────────────────

function baseTemplate({ accentColor = '#18181b', icon = '●', heading, bodyHtml, ctaHref, ctaLabel }) {
  const font = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
  const ctaBlock = ctaHref ? `
    <tr>
      <td align="center" style="padding: 28px 40px 8px;">
        <a href="${ctaHref}"
           style="display:inline-block; background:${accentColor}; color:#ffffff;
                  font-family:${font}; font-size:14px; font-weight:600;
                  text-decoration:none; padding:12px 28px; border-radius:4px;
                  letter-spacing:0.02em;">
          ${ctaLabel}
        </a>
      </td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${heading}</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:${font};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:540px; background:#ffffff; border-radius:6px;
                      overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header bar -->
          <tr>
            <td style="background:${accentColor}; padding:28px 40px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:14px; font-size:26px; line-height:1; vertical-align:middle;">
                    ${icon}
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:10px; font-weight:600; letter-spacing:0.12em;
                                text-transform:uppercase; color:rgba(255,255,255,0.65);
                                margin-bottom:4px;">
                      AcadHost
                    </div>
                    <div style="font-size:18px; font-weight:700; color:#ffffff; line-height:1.2;">
                      ${heading}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px 8px; color:#374151; font-size:14px; line-height:1.65;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- CTA (optional) -->
          ${ctaBlock}

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px; border-top:1px solid #e5e7eb; margin-top:16px;">
              <p style="margin:0; font-size:11px; color:#9ca3af; line-height:1.6;">
                This is an automated message from <strong style="color:#6b7280;">AcadHost</strong> — your institution's project hosting platform.
                If you did not expect this email, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Shared detail table helper ────────────────────────────────
// Renders a clean key-value table used in several email types.

function detailTable(rows) {
  const rowsHtml = rows.map(([label, value], i) => {
    const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
    return `<tr>
      <td style="padding:10px 14px; font-size:13px; font-weight:600; color:#374151;
                 width:38%; background:${bg}; border-bottom:1px solid #f3f4f6;">${label}</td>
      <td style="padding:10px 14px; font-size:13px; color:#6b7280;
                 background:${bg}; border-bottom:1px solid #f3f4f6;">${value}</td>
    </tr>`;
  }).join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
          style="border:1px solid #e5e7eb; border-radius:4px; overflow:hidden;
                 margin:16px 0; font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    ${rowsHtml}
  </table>`;
}

// ── Internal send helper ─────────────────────────────────────

/**
 * @param {{ to: string, subject: string, html: string, text: string }} mailOptions
 * @throws {{ code: 'EMAIL_LIMIT_REACHED'|'EMAIL_SEND_FAILED', message: string }}
 */
async function sendEmail(mailOptions) {
  const dailyLimit = parseInt(process.env.SMTP_DAILY_LIMIT, 10) || 500;

  if (dailySendCount >= dailyLimit) {
    console.warn(`[emailService] Daily email limit reached (${dailyLimit}). Email to ${mailOptions.to} was not sent.`);
    throw {
      code: 'EMAIL_LIMIT_REACHED',
      message: 'Daily email send limit reached',
    };
  }

  const fullOptions = {
    from:    `"${process.env.SMTP_FROM_NAME || 'AcadHost'}" <${process.env.SMTP_USER}>`,
    to:      mailOptions.to,
    subject: mailOptions.subject,
    html:    mailOptions.html,
    text:    mailOptions.text,
  };

  try {
    await transporter.sendMail(fullOptions);
    dailySendCount += 1;
    console.info(`[emailService] Email sent to ${mailOptions.to}: ${mailOptions.subject}`);
  } catch (smtpError) {
    console.error(`[emailService] SMTP error sending to ${mailOptions.to}: ${smtpError.message}`);
    throw {
      code: 'EMAIL_SEND_FAILED',
      message: smtpError.message,
    };
  }
}

// ── Template builders ────────────────────────────────────────

// -- Invitation --

function buildInvitationHtml(email, registrationLink, batchYear) {
  const expiryHours = 2;
  const batchRow    = batchYear != null ? [['Batch Year', String(batchYear)]] : [];

  const body = `
    <p>You've been invited to join <strong>AcadHost</strong>, your institution's project hosting platform.</p>
    ${detailTable([
    ['Invited email', email],
    ...batchRow,
    ['Link expires in', `${expiryHours} hours`],
  ])}
    <p style="font-size:13px; color:#6b7280;">
      Click the button below to set up your account. If the link expires, contact your
      administrator to receive a new invitation.
    </p>`;

  return baseTemplate({
    accentColor: '#16a34a',
    icon: '✉',
    heading: "You're invited",
    bodyHtml: body,
    ctaHref: registrationLink,
    ctaLabel: 'Complete Registration →',
  });
}

function buildInvitationText(email, registrationLink, batchYear) {
  const expiryHours = 2;
  const batchLine   = batchYear != null ? `Batch Year: ${batchYear}\n` : '';
  return `Welcome to AcadHost

You have been invited to join AcadHost, your institution's project hosting platform.

${batchLine}Complete your registration:
${registrationLink}

This link expires in ${expiryHours} hours. If it expires, contact your administrator for a new invitation.

If you did not expect this email, you can safely ignore it.`;
}

// -- Password reset --

function buildPasswordResetHtml(email, resetLink) {
  const body = `
    <p>We received a request to reset the password for your AcadHost account.</p>
    ${detailTable([
    ['Account', email],
    ['Link expires in', '1 hour'],
  ])}
    <p style="font-size:13px; color:#6b7280;">
      If you did not request a password reset, no action is needed — your password
      will not be changed.
    </p>`;

  return baseTemplate({
    accentColor: '#2563eb',
    icon: '🔑',
    heading: 'Password Reset Request',
    bodyHtml: body,
    ctaHref: resetLink,
    ctaLabel: 'Reset My Password →',
  });
}

function buildPasswordResetText(email, resetLink) {
  return `Password Reset Request

We received a request to reset the password for your AcadHost account (${email}).

Reset your password:
${resetLink}

This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.`;
}

// -- Project stopped --

function buildProjectStoppedHtml(email, projectTitle, subdomain, projectUrl) {
  const body = `
    <p>Your project has been <strong>stopped</strong> by the platform administrator.</p>
    ${detailTable([
    ['Project', projectTitle],
    ['URL', `<a href="${projectUrl}" style="color:#2563eb;">${projectUrl}</a>`],
  ])}
    <p style="font-size:13px; color:#6b7280;">
      Your project data and configuration are preserved. You can restart the project
      at any time from your AcadHost dashboard.
    </p>`;

  return baseTemplate({
    accentColor: '#d97706',
    icon: '⏸',
    heading: 'Project Stopped',
    bodyHtml: body,
    ctaHref: `${process.env.FRONTEND_URL || process.env.PLATFORM_URL}/projects`,
    ctaLabel: 'Go to Dashboard →',
  });
}

function buildProjectStoppedText(email, projectTitle, subdomain, projectUrl) {
  return `Project Stopped

Your project "${projectTitle}" (${projectUrl}) has been stopped by the platform administrator.

Your project data and configuration are preserved. You can restart the project at any time from your AcadHost dashboard.

If you have questions, contact your administrator.`;
}

// -- Project terminated --

function buildProjectTerminatedHtml(email, projectTitle, subdomain, projectUrl) {
  const body = `
    <p>Your project has been <strong>permanently terminated</strong> by the platform administrator.</p>
    ${detailTable([
    ['Project', projectTitle],
    ['URL', projectUrl],
  ])}
    <p style="font-size:13px; color:#6b7280;">
      The project container, source files, and subdomain have been removed.
      This action is permanent and cannot be undone. If you have questions,
      please contact your administrator.
    </p>`;

  return baseTemplate({
    accentColor: '#dc2626',
    icon: '✕',
    heading: 'Project Terminated',
    bodyHtml: body,
  });
}

function buildProjectTerminatedText(email, projectTitle, subdomain, projectUrl) {
  return `Project Terminated

Your project "${projectTitle}" (${projectUrl}) has been terminated by the platform administrator.

The project container, source files, and subdomain have been removed. This action is permanent and cannot be undone.

If you have questions, contact your administrator.`;
}

// -- Resource request submitted (to admin) --

function buildResourceRequestSubmittedHtml(studentName, studentEmail, resourceType, requestedValue, description) {
  const body = `
    <p>A student has submitted a resource increase request that requires your review.</p>
    ${detailTable([
    ['Student',          `${studentName} (${studentEmail})`],
    ['Resource Type',    resourceType.toUpperCase()],
    ['Requested Value',  requestedValue],
    ['Justification',    description],
  ])}`;

  return baseTemplate({
    accentColor: '#7c3aed',
    icon: '📋',
    heading: 'New Resource Request',
    bodyHtml: body,
    ctaHref:  `${process.env.FRONTEND_URL || process.env.PLATFORM_URL}/login`,
    ctaLabel: 'Review in Admin Dashboard →',
  });
}

function buildResourceRequestSubmittedText(studentName, studentEmail, resourceType, requestedValue, description) {
  return `New Resource Request

A student has submitted a resource increase request that requires your review.

Student:         ${studentName} (${studentEmail})
Resource Type:   ${resourceType.toUpperCase()}
Requested Value: ${requestedValue}
Justification:   ${description}

Please log in to the AcadHost admin dashboard to approve or deny this request.`;
}

// -- Resource request reviewed (to student) --

function buildResourceRequestReviewedHtml(studentName, resourceType, requestedValue, status, adminNotes) {
  const approved    = status === 'approved';
  const accentColor = approved ? '#16a34a' : '#dc2626';
  const statusWord  = approved ? 'Approved' : 'Denied';
  const icon        = approved ? '✓' : '✕';
  const notesRows   = adminNotes ? [['Admin Notes', adminNotes]] : [];
  const outcomeMsg  = approved
      ? 'Your quota has been updated automatically. You can now use the increased resources.'
      : 'Your quota has not been changed. If you have questions, please contact your administrator.';

  const body = `
    <p>Hi ${studentName}, your resource request has been reviewed.</p>
    ${detailTable([
    ['Resource Type',   resourceType.toUpperCase()],
    ['Requested Value', requestedValue],
    ['Decision',        `<strong style="color:${accentColor};">${statusWord}</strong>`],
    ...notesRows,
  ])}
    <p style="font-size:13px; color:#6b7280;">${outcomeMsg}</p>`;

  return baseTemplate({
    accentColor,
    icon,
    heading: `Request ${statusWord}`,
    bodyHtml: body,
    ctaHref: `${process.env.FRONTEND_URL || process.env.PLATFORM_URL}/resource-requests`,
    ctaLabel: 'View in Dashboard →',
  });
}

function buildResourceRequestReviewedText(studentName, resourceType, requestedValue, status, adminNotes) {
  const statusWord = status === 'approved' ? 'APPROVED' : 'DENIED';
  const notesLine  = adminNotes ? `\nAdmin Notes:     ${adminNotes}` : '';
  const outcomeMsg = status === 'approved'
      ? 'Your quota has been updated automatically. You can now use the increased resources.'
      : 'Your quota has not been changed. If you have questions, contact your administrator.';

  return `Resource Request ${statusWord}

Hi ${studentName}, your resource request has been reviewed.

Resource Type:   ${resourceType.toUpperCase()}
Requested Value: ${requestedValue}
Decision:        ${statusWord}${notesLine}

${outcomeMsg}`;
}

// -- Account suspended --

function buildStudentSuspendedHtml(name) {
  const displayName = name || 'there';
  const body = `
    <p>Hi ${displayName},</p>
    <p>Your AcadHost account has been <strong>suspended</strong> by the administrator.
       You will not be able to log in or access the platform until your account is reactivated.</p>
    <p style="font-size:13px; color:#6b7280;">
      Your projects, databases, and files have been preserved and are not affected by this action.
      If you believe this was in error, please contact your administrator.
    </p>`;

  return baseTemplate({
    accentColor: '#dc2626',
    icon: '🔒',
    heading: 'Account Suspended',
    bodyHtml: body,
  });
}

// -- Account reactivated --

function buildStudentUnsuspendedHtml(name) {
  const displayName = name || 'there';
  const body = `
    <p>Hi ${displayName},</p>
    <p>Your AcadHost account has been <strong>reactivated</strong>. You can now log in and
       resume using the platform as normal.</p>`;

  return baseTemplate({
    accentColor: '#16a34a',
    icon: '🔓',
    heading: 'Account Reactivated',
    bodyHtml: body,
    ctaHref: `${process.env.FRONTEND_URL || process.env.PLATFORM_URL}/login`,
    ctaLabel: 'Sign In →',
  });
}

// ── Exported send functions ──────────────────────────────────

async function sendInvitationEmail(email, registrationLink, batchYear) {
  const subject = "You've been invited to AcadHost";
  await sendEmail({
    to: email,
    subject,
    html: buildInvitationHtml(email, registrationLink, batchYear),
    text: buildInvitationText(email, registrationLink, batchYear),
  });
}

async function sendPasswordResetEmail(email, resetLink) {
  const subject = 'AcadHost \u2014 Password Reset Request';
  await sendEmail({
    to: email,
    subject,
    html: buildPasswordResetHtml(email, resetLink),
    text: buildPasswordResetText(email, resetLink),
  });
}

async function sendProjectStoppedEmail(email, projectTitle, subdomain) {
  const projectUrl = `https://${subdomain}.${process.env.PLATFORM_DOMAIN}`;
  const subject    = `AcadHost \u2014 Your project \u201c${projectTitle}\u201d has been stopped`;
  await sendEmail({
    to: email,
    subject,
    html: buildProjectStoppedHtml(email, projectTitle, subdomain, projectUrl),
    text: buildProjectStoppedText(email, projectTitle, subdomain, projectUrl),
  });
}

async function sendProjectTerminatedEmail(email, projectTitle, subdomain) {
  const projectUrl = `https://${subdomain}.${process.env.PLATFORM_DOMAIN}`;
  const subject    = `AcadHost \u2014 Your project \u201c${projectTitle}\u201d has been terminated`;
  await sendEmail({
    to: email,
    subject,
    html: buildProjectTerminatedHtml(email, projectTitle, subdomain, projectUrl),
    text: buildProjectTerminatedText(email, projectTitle, subdomain, projectUrl),
  });
}

async function sendResourceRequestSubmittedEmail(adminEmail, studentName, studentEmail, resourceType, requestedValue, description) {
  const subject = `AcadHost \u2014 New Resource Request from ${studentName}`;
  await sendEmail({
    to: adminEmail,
    subject,
    html: buildResourceRequestSubmittedHtml(studentName, studentEmail, resourceType, requestedValue, description),
    text: buildResourceRequestSubmittedText(studentName, studentEmail, resourceType, requestedValue, description),
  });
}

async function sendResourceRequestReviewedEmail(studentEmail, studentName, resourceType, requestedValue, status, adminNotes) {
  const statusWord = status === 'approved' ? 'approved' : 'denied';
  const subject    = `AcadHost \u2014 Your resource request has been ${statusWord}`;
  await sendEmail({
    to: studentEmail,
    subject,
    html: buildResourceRequestReviewedHtml(studentName, resourceType, requestedValue, status, adminNotes),
    text: buildResourceRequestReviewedText(studentName, resourceType, requestedValue, status, adminNotes),
  });
}

async function sendStudentSuspendedEmail(to, name) {
  await sendEmail({
    to,
    subject: 'Your AcadHost account has been suspended',
    html: buildStudentSuspendedHtml(name),
    text: `Hello ${name || 'there'},\n\nYour AcadHost account has been suspended by the administrator. You will not be able to log in or access the platform until your account is reactivated.\n\nYour projects, databases, and files have been preserved.\n\nIf you believe this was in error, please contact your administrator.\n\n— AcadHost`,
  });
}

async function sendStudentUnsuspendedEmail(to, name) {
  await sendEmail({
    to,
    subject: 'Your AcadHost account has been reactivated',
    html: buildStudentUnsuspendedHtml(name),
    text: `Hello ${name || 'there'},\n\nYour AcadHost account has been reactivated. You can now log in and resume using the platform as normal.\n\n— AcadHost`,
  });
}

module.exports = {
  sendInvitationEmail,
  sendPasswordResetEmail,
  sendProjectStoppedEmail,
  sendProjectTerminatedEmail,
  sendResourceRequestSubmittedEmail,
  sendResourceRequestReviewedEmail,
  sendStudentSuspendedEmail,
  sendStudentUnsuspendedEmail,
};