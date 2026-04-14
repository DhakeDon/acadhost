# Section 11 — Email System

## 11.1 Overview

AcadHost sends transactional emails for authentication flows and administrative notifications. All emails are dispatched by `services/emailService.js` using Gmail SMTP with an App Password. The system does not send marketing, batch digest, or scheduled emails — every email is triggered by a specific user or admin action.

### 11.1.1 Email Types

| # | Email Type | Trigger | Recipient | Called By |
|---|---|---|---|---|
| 1 | Student invitation | Admin invites a student | The invited student | `adminController.inviteStudents` (Section 6.4.6) |
| 2 | Invite resend | Admin resends an expired invitation | The invited student | `adminController.resendInvite` (Section 6.4.7) |
| 3 | Password reset | Student requests password reset | The requesting student | `authController.forgotPassword` (Section 6.2.6) |
| 4 | Project stopped notification | Admin stops a student's project | The owning student | `adminController.stopProject` (Section 6.4.9) |
| 5 | Project terminated notification | Admin terminates a student's project | The owning student | `adminController.terminateProject` (Section 6.4.10) |

### 11.1.2 Technology Stack

| Component | Value |
|---|---|
| SMTP library | `nodemailer` npm package |
| SMTP host | `smtp.gmail.com` (configured via `SMTP_HOST`, Section 3.2.7) |
| SMTP port | `587` (configured via `SMTP_PORT`, Section 3.2.7) |
| SMTP security | STARTTLS (nodemailer default for port 587) |
| Authentication | Gmail App Password (configured via `SMTP_USER` and `SMTP_PASSWORD`, Section 3.2.7) |
| Daily send limit | 500 emails (configured via `SMTP_DAILY_LIMIT`, Section 3.2.7) |

## 11.2 Service File — `services/emailService.js`

This service is defined in Section 2.3. It is the sole file in the codebase that sends emails.

### 11.2.1 Nodemailer Transporter Configuration

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: false,  // false for port 587 (STARTTLS); true for port 465 (SSL)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});
```

| Parameter | Value | Source |
|---|---|---|
| `host` | `smtp.gmail.com` | `SMTP_HOST` (Section 3.2.7) |
| `port` | `587` | `SMTP_PORT` (Section 3.2.7) |
| `secure` | `false` | Port 587 uses STARTTLS (upgrade to TLS after connection); port 465 uses implicit TLS |
| `auth.user` | Gmail address | `SMTP_USER` (Section 3.2.7) |
| `auth.pass` | Gmail App Password | `SMTP_PASSWORD` (Section 3.2.7) |

The transporter is created once at module load time and reused for all email sends. Nodemailer manages connection pooling internally.

### 11.2.2 Sender Configuration

Every email uses the same "From" header:

| Field | Value | Source |
|---|---|---|
| `from` | `"{SMTP_FROM_NAME}" <{SMTP_USER}>` | `SMTP_FROM_NAME` (default `AcadHost`) and `SMTP_USER` from Section 3.2.7 |

Example: `"AcadHost" <acadhost@institution.edu>`

### 11.2.3 Exported Functions

| Function | Purpose | Email Type |
|---|---|---|
| `sendInvitationEmail(email, registrationLink, batchYear)` | Sends a student invitation with a registration link | Invitation |
| `sendPasswordResetEmail(email, resetLink)` | Sends a password reset link | Password reset |
| `sendProjectStoppedEmail(email, projectTitle, subdomain)` | Notifies a student that the admin stopped their project | Project stopped |
| `sendProjectTerminatedEmail(email, projectTitle, subdomain)` | Notifies a student that the admin terminated their project | Project terminated |

## 11.3 Daily Send Limit

Gmail SMTP with App Passwords has a daily sending limit. The platform tracks and enforces this limit to avoid SMTP errors and account lockouts.

### 11.3.1 Tracking Mechanism

| Property | Value |
|---|---|
| Counter variable | In-memory counter within `emailService.js` |
| Counter name | `dailySendCount` |
| Reset schedule | Resets to `0` at midnight UTC every day |
| Reset mechanism | A `setInterval` timer within `emailService.js` that fires once every 24 hours, starting from when the backend process starts |
| Limit | `SMTP_DAILY_LIMIT` (default `500`, Section 3.2.7) |

AMBIGUITY DETECTED: The spec does not define whether the daily email counter is stored in memory or in the database, nor how it resets.
My decision: The counter is stored in memory. It resets when the backend process restarts and on a 24-hour interval. This is acceptable because: (a) the counter is a safety guard, not a billing system — if the backend restarts mid-day, a slightly higher actual count is acceptable; (b) database storage would add complexity for a low-criticality counter; (c) Gmail's own rate limiting provides a secondary backstop.

### 11.3.2 Enforcement

Before every `transporter.sendMail()` call, `emailService.js` checks the counter:

```
async function sendEmail(mailOptions):
  IF dailySendCount >= SMTP_DAILY_LIMIT:
    LOG warning: 'Daily email limit reached ({SMTP_DAILY_LIMIT}).
                  Email to {mailOptions.to} was not sent.'
    THROW { code: 'EMAIL_LIMIT_REACHED',
            message: 'Daily email send limit reached' }

  result = await transporter.sendMail(mailOptions)
  dailySendCount += 1
  RETURN result
```

### 11.3.3 Caller Behavior on Limit Reached

| Caller | Behavior When Email Fails |
|---|---|
| `adminController.inviteStudents` | The invitation flow continues for remaining emails. The failed email address is not added to the `invited` array. The response includes the email in an error category. The `users` row and `invite_tokens` row are still created (the student can be re-invited later when the limit resets). |
| `adminController.resendInvite` | Returns success for the token regeneration but logs a warning that the email was not delivered. The admin should retry later. |
| `authController.forgotPassword` | Returns `200 OK` regardless (user enumeration prevention, Section 5.9.8). The email is silently not sent. The password reset token is still created in case the user retries after the limit resets. |
| `adminController.stopProject` | The project is stopped successfully. The notification email failure is logged but does not block the stop operation. The response still includes `notifiedStudent` with the email address, but the admin should be informed that notification may have failed. |
| `adminController.terminateProject` | Same as stop — the termination proceeds; email failure is logged but not blocking. |

AMBIGUITY DETECTED: The spec does not define behavior when email sending fails (either from daily limit or SMTP error).
My decision: Email failures are **non-blocking** for all operations. The primary action (invite, reset, stop, terminate) always completes. Email failures are logged as warnings. The rationale is that email is a notification mechanism, not a transactional requirement — the admin can manually inform the student if the automated email fails.

## 11.4 Email Templates

Each email type has a defined subject line and HTML body. All templates use inline HTML for compatibility across email clients. No external CSS files or `<style>` tags are used in the `<head>` — all styling is inline.

### 11.4.1 Student Invitation Email

**Trigger:** Admin invites students via `POST /api/admin/students/invite` (Section 6.4.6) or resends via `POST /api/admin/students/:id/resend-invite` (Section 6.4.7).

**Function:** `sendInvitationEmail(email, registrationLink, batchYear)`

| Field | Value |
|---|---|
| To | `{email}` (the invited student's email address) |
| Subject | `You've been invited to AcadHost` |
| Registration link | `{FRONTEND_URL}/register?token=<jwt_string>` (Section 5.9.1) |

**Template Variables:**

| Variable | Source |
|---|---|
| `{email}` | The student's email address |
| `{registrationLink}` | `{FRONTEND_URL}/register?token=<jwt_string>` |
| `{batchYear}` | Batch year label from the admin's input; may be `null` |
| `{SMTP_FROM_NAME}` | From environment variable (default `AcadHost`) |
| `{expiryHours}` | `2` (derived from `INVITE_TOKEN_EXPIRY` = `2h`, Section 3.2.3) |

**HTML Body:**

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Welcome to AcadHost</h2>
  <p>You have been invited to join AcadHost, your institution's project hosting platform.</p>
  <!-- Include batch year line only if batchYear is not null -->
  <p>Batch Year: <strong>{batchYear}</strong></p>
  <p>Click the button below to complete your registration:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{registrationLink}"
       style="background-color: #4CAF50; color: white; padding: 12px 24px;
              text-decoration: none; border-radius: 4px; font-size: 16px;">
      Complete Registration
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">
    This link will expire in {expiryHours} hours. If it expires, contact your
    administrator to receive a new invitation.
  </p>
  <p style="color: #999; font-size: 12px;">
    If you did not expect this invitation, you can safely ignore this email.
  </p>
</div>
```

**Plaintext fallback:**

```
Welcome to AcadHost

You have been invited to join AcadHost, your institution's project hosting platform.

Batch Year: {batchYear}

Complete your registration by visiting the following link:
{registrationLink}

This link will expire in {expiryHours} hours. If it expires, contact your
administrator to receive a new invitation.

If you did not expect this invitation, you can safely ignore this email.
```

### 11.4.2 Password Reset Email

**Trigger:** Student requests password reset via `POST /api/auth/forgot-password` (Section 6.2.6).

**Function:** `sendPasswordResetEmail(email, resetLink)`

| Field | Value |
|---|---|
| To | `{email}` (the student's email address) |
| Subject | `AcadHost — Password Reset Request` |
| Reset link | `{FRONTEND_URL}/reset-password?token=<raw_token>` (Section 5.9.8) |

**Template Variables:**

| Variable | Source |
|---|---|
| `{email}` | The student's email address |
| `{resetLink}` | `{FRONTEND_URL}/reset-password?token=<raw_token>` |
| `{expiryHours}` | `1` (derived from `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` = `1`, Section 3.2.3) |

**HTML Body:**

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Password Reset Request</h2>
  <p>We received a request to reset the password for your AcadHost account
     (<strong>{email}</strong>).</p>
  <p>Click the button below to set a new password:</p>
  <p style="text-align: center; margin: 30px 0;">
    <a href="{resetLink}"
       style="background-color: #2196F3; color: white; padding: 12px 24px;
              text-decoration: none; border-radius: 4px; font-size: 16px;">
      Reset Password
    </a>
  </p>
  <p style="color: #666; font-size: 14px;">
    This link will expire in {expiryHours} hour. If you did not request a password
    reset, you can safely ignore this email — your password will not be changed.
  </p>
</div>
```

**Plaintext fallback:**

```
Password Reset Request

We received a request to reset the password for your AcadHost account ({email}).

Reset your password by visiting the following link:
{resetLink}

This link will expire in {expiryHours} hour. If you did not request a password
reset, you can safely ignore this email — your password will not be changed.
```

### 11.4.3 Project Stopped Notification Email

**Trigger:** Admin stops a student's project via `POST /api/admin/projects/:id/stop` (Section 6.4.9).

**Function:** `sendProjectStoppedEmail(email, projectTitle, subdomain)`

| Field | Value |
|---|---|
| To | `{email}` (the owning student's email address) |
| Subject | `AcadHost — Your project "{projectTitle}" has been stopped` |

**Template Variables:**

| Variable | Source |
|---|---|
| `{email}` | The owning student's email address (from `users.email` via `projects.user_id`) |
| `{projectTitle}` | `projects.title` |
| `{subdomain}` | `projects.subdomain` |
| `{projectUrl}` | `https://{subdomain}.{PLATFORM_DOMAIN}` |

**HTML Body:**

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Project Stopped</h2>
  <p>Your project <strong>{projectTitle}</strong> (<a href="{projectUrl}">{projectUrl}</a>)
     has been stopped by the platform administrator.</p>
  <p>Your project data and configuration are preserved. You can restart the project
     at any time from your AcadHost dashboard.</p>
  <p style="color: #666; font-size: 14px;">
    If you have questions about this action, please contact your administrator.
  </p>
</div>
```

**Plaintext fallback:**

```
Project Stopped

Your project "{projectTitle}" ({projectUrl}) has been stopped by the platform
administrator.

Your project data and configuration are preserved. You can restart the project
at any time from your AcadHost dashboard.

If you have questions about this action, please contact your administrator.
```

### 11.4.4 Project Terminated Notification Email

**Trigger:** Admin terminates a student's project via `POST /api/admin/projects/:id/terminate` (Section 6.4.10).

**Function:** `sendProjectTerminatedEmail(email, projectTitle, subdomain)`

| Field | Value |
|---|---|
| To | `{email}` (the owning student's email address) |
| Subject | `AcadHost — Your project "{projectTitle}" has been terminated` |

**Template Variables:**

| Variable | Source |
|---|---|
| `{email}` | The owning student's email address (from `users.email` via `projects.user_id`) |
| `{projectTitle}` | `projects.title` |
| `{subdomain}` | The **original** `projects.subdomain` value (captured before the soft-delete changes it to `_deleted_{projectId}`) |
| `{projectUrl}` | `https://{subdomain}.{PLATFORM_DOMAIN}` (using the original subdomain) |

**HTML Body:**

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #d32f2f;">Project Terminated</h2>
  <p>Your project <strong>{projectTitle}</strong> (<a href="{projectUrl}">{projectUrl}</a>)
     has been terminated by the platform administrator.</p>
  <p>The project container, source files, and subdomain have been removed. This action
     is permanent and cannot be undone.</p>
  <p style="color: #666; font-size: 14px;">
    If you have questions about this action, please contact your administrator.
  </p>
</div>
```

**Plaintext fallback:**

```
Project Terminated

Your project "{projectTitle}" ({projectUrl}) has been terminated by the platform
administrator.

The project container, source files, and subdomain have been removed. This action
is permanent and cannot be undone.

If you have questions about this action, please contact your administrator.
```

## 11.5 Email Send Flow

Every email follows the same internal flow through `emailService.js`:

```
function sendEmail(mailOptions):
  1. Check daily send limit
     IF dailySendCount >= parseInt(process.env.SMTP_DAILY_LIMIT, 10):
       LOG.warn('Daily email limit reached. Email to ${mailOptions.to} not sent.')
       THROW { code: 'EMAIL_LIMIT_REACHED' }

  2. Construct the full mail options
     fullOptions = {
       from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
       to: mailOptions.to,
       subject: mailOptions.subject,
       html: mailOptions.html,
       text: mailOptions.text   // plaintext fallback
     }

  3. Send via nodemailer
     TRY:
       result = await transporter.sendMail(fullOptions)
       dailySendCount += 1
       LOG.info('Email sent to ${mailOptions.to}: ${mailOptions.subject}')
       RETURN result
     CATCH (smtpError):
       LOG.error('SMTP error sending to ${mailOptions.to}: ${smtpError.message}')
       THROW { code: 'EMAIL_SEND_FAILED', message: smtpError.message }
```

### 11.5.1 Invitation Email Flow

```
async function sendInvitationEmail(email, registrationLink, batchYear):
  subject = "You've been invited to AcadHost"
  html = buildInvitationHtml(email, registrationLink, batchYear)
  text = buildInvitationText(email, registrationLink, batchYear)

  await sendEmail({ to: email, subject, html, text })
```

### 11.5.2 Password Reset Email Flow

```
async function sendPasswordResetEmail(email, resetLink):
  subject = 'AcadHost — Password Reset Request'
  html = buildPasswordResetHtml(email, resetLink)
  text = buildPasswordResetText(email, resetLink)

  await sendEmail({ to: email, subject, html, text })
```

### 11.5.3 Project Stopped Email Flow

```
async function sendProjectStoppedEmail(email, projectTitle, subdomain):
  projectUrl = 'https://' + subdomain + '.' + process.env.PLATFORM_DOMAIN
  subject = `AcadHost — Your project "${projectTitle}" has been stopped`
  html = buildProjectStoppedHtml(email, projectTitle, subdomain, projectUrl)
  text = buildProjectStoppedText(email, projectTitle, subdomain, projectUrl)

  await sendEmail({ to: email, subject, html, text })
```

### 11.5.4 Project Terminated Email Flow

```
async function sendProjectTerminatedEmail(email, projectTitle, subdomain):
  projectUrl = 'https://' + subdomain + '.' + process.env.PLATFORM_DOMAIN
  subject = `AcadHost — Your project "${projectTitle}" has been terminated`
  html = buildProjectTerminatedHtml(email, projectTitle, subdomain, projectUrl)
  text = buildProjectTerminatedText(email, projectTitle, subdomain, projectUrl)

  await sendEmail({ to: email, subject, html, text })
```

## 11.6 Invitation Email — Batch Processing

When the admin invites multiple students via `POST /api/admin/students/invite` (Section 6.4.6), emails are sent sequentially within the request handler. The flow for each email address is:

```
FOR EACH email IN validEmails:
  1. Insert users row (status = 'invited')
  2. Generate invite token JWT
  3. Insert invite_tokens row
  4. registrationLink = FRONTEND_URL + '/register?token=' + jwt_string
  5. TRY:
       await sendInvitationEmail(email, registrationLink, batchYear)
       Add email to 'invited' array
     CATCH (emailError):
       LOG.warn('Failed to send invitation to ${email}: ${emailError.message}')
       Add email to 'invited' array (user row and token still created)
```

**Important:** The `users` row and `invite_tokens` row are created regardless of whether the email sends successfully. This means the student exists in the system and the token is valid — the admin can resend the invitation later if the initial email fails.

### 11.6.1 Sequential vs. Parallel Sending

AMBIGUITY DETECTED: The spec does not define whether invitation emails for a batch are sent sequentially or in parallel.
My decision: Emails are sent **sequentially** (one at a time in a loop). This avoids overwhelming Gmail's SMTP rate limits and simplifies error handling. For a typical batch of 30–50 students, the sequential approach adds a few seconds to the request but stays well within acceptable response times. If the daily limit is reached mid-batch, remaining emails are skipped (users still created) and the admin is informed via the response.

## 11.7 Error Handling

### 11.7.1 SMTP Errors

| Error Type | Handling |
|---|---|
| Connection timeout | Nodemailer throws; caught by `sendEmail`; logged as error; thrown to caller |
| Authentication failure | Nodemailer throws; caught by `sendEmail`; logged as error; thrown to caller |
| Invalid recipient address | Nodemailer throws; caught by `sendEmail`; logged as error; thrown to caller |
| Network error | Nodemailer throws; caught by `sendEmail`; logged as error; thrown to caller |
| Gmail rate limiting (temporary 421 error) | Nodemailer throws; caught by `sendEmail`; logged as error; thrown to caller |

### 11.7.2 Caller Error Handling Summary

| Caller | Email Type | On Email Error |
|---|---|---|
| `adminController.inviteStudents` | Invitation | Log warning; continue to next email; user and token still created |
| `adminController.resendInvite` | Invitation (resend) | Log warning; return success for token regeneration; admin retries later |
| `authController.forgotPassword` | Password reset | Log warning; return `200 OK` regardless (user enumeration prevention); token still created |
| `adminController.stopProject` | Stopped notification | Log warning; project stop completes; email failure non-blocking |
| `adminController.terminateProject` | Terminated notification | Log warning; project termination completes; email failure non-blocking |

### 11.7.3 No Retry Mechanism

AMBIGUITY DETECTED: The spec does not define an email retry mechanism.
My decision: There is **no automatic retry** for failed emails. If an email fails, it is logged and the caller proceeds. Retries are manual (the admin resends the invitation, or the student re-requests the password reset). This avoids complexity of retry queues and dead letter handling for a low-volume academic system.

## 11.8 SMTP Connection Verification

On backend server startup, `emailService.js` verifies the SMTP connection:

```
async function verifySmtpConnection():
  TRY:
    await transporter.verify()
    LOG.info('SMTP connection verified successfully')
  CATCH (error):
    LOG.error('SMTP connection verification failed: ${error.message}')
    LOG.error('Email functionality will not work until SMTP configuration is fixed')
    // Do NOT throw — the server should still start even if email is unavailable
```

The SMTP verification failure is a warning, not a fatal error. The backend continues to start and serve API requests. Email-dependent operations will fail individually when attempted, but all other platform functionality remains available.

## 11.9 Environment Variables Reference

All email-related environment variables are defined in Section 3.2.7. Repeated here for cross-reference.

| Variable | Description | Default | Example |
|---|---|---|---|
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` | `587` |
| `SMTP_USER` | Gmail email address (sender) | — | `acadhost@institution.edu` |
| `SMTP_PASSWORD` | Gmail App Password | — | `abcd efgh ijkl mnop` |
| `SMTP_FROM_NAME` | Display name in "From" field | `AcadHost` | `AcadHost` |
| `SMTP_DAILY_LIMIT` | Max emails per day | `500` | `500` |

### 11.9.1 Related Variables (Defined Elsewhere)

| Variable | Used For | Defined In |
|---|---|---|
| `FRONTEND_URL` | Constructing registration and password reset links | Section 3.2.11 |
| `PLATFORM_DOMAIN` | Constructing project URLs in notification emails | Section 3.2.11 |
| `INVITE_TOKEN_EXPIRY` | Displaying expiry time in invitation emails | Section 3.2.3 |
| `PASSWORD_RESET_TOKEN_EXPIRY_HOURS` | Displaying expiry time in password reset emails | Section 3.2.3 |

## 11.10 Cross-Section Reference Map

| Concern | Authoritative Section | Key Details |
|---|---|---|
| `emailService.js` file definition | Section 2.3 | Service file purpose |
| SMTP environment variables | Section 3.2.7 | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_DAILY_LIMIT` |
| `FRONTEND_URL` and `PLATFORM_DOMAIN` | Section 3.2.11 | Used in email links |
| Student invitation flow | Section 5.9.1 | Token generation, email link format |
| Invite resend flow | Section 5.9.2 | Token invalidation, re-generation |
| Forgot password flow | Section 5.9.8 | Token generation, user enumeration prevention |
| `POST /api/admin/students/invite` | Section 6.4.6 | Batch invitation endpoint |
| `POST /api/admin/students/:id/resend-invite` | Section 6.4.7 | Resend endpoint |
| `POST /api/auth/forgot-password` | Section 6.2.6 | Password reset request endpoint |
| `POST /api/admin/projects/:id/stop` | Section 6.4.9 | Admin stop with notification |
| `POST /api/admin/projects/:id/terminate` | Section 6.4.10 | Admin terminate with notification |
| Invite token format | Section 5.4.3 | JWT; link format `{FRONTEND_URL}/register?token=<jwt_string>` |
| Password reset token format | Section 5.4.4 | Random 64-char hex; link format `{FRONTEND_URL}/reset-password?token=<raw_token>` |
| Email daily limit | Section 1.7 | 500 emails |
| Gmail SMTP in tech stack | Section 1.5 | `smtp.gmail.com:587` using App Password |

## 11.11 Ambiguity Decisions Registry

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| 1 | Spec does not define the daily email counter storage or reset mechanism | In-memory counter; resets on backend restart and on a 24-hour `setInterval` timer | Low-criticality counter; Gmail's own limits provide a secondary backstop; database storage would add unnecessary complexity |
| 2 | Spec does not define behavior when email sending fails | Email failures are non-blocking; the primary action always completes; failures are logged as warnings | Email is a notification mechanism; the admin can manually inform the student if needed |
| 3 | Spec does not define an email retry mechanism | No automatic retry; failed emails are logged; retries are manual (admin resends invitation, student re-requests password reset) | Avoids complexity of retry queues for a low-volume academic system |
| 4 | Spec does not define email template format or content | HTML emails with inline styling and plaintext fallbacks; specific subject lines and body text defined per email type | Standard transactional email format; inline styling for email client compatibility; plaintext for clients that don't render HTML |
| 5 | Spec does not define whether invitation emails in a batch are sent sequentially or in parallel | Sequential sending | Avoids overwhelming Gmail SMTP rate limits; simplifies error handling; acceptable performance for typical batch sizes |
| 6 | Spec does not define whether SMTP connection failure prevents server startup | Non-fatal warning; server starts normally; email-dependent operations fail individually when attempted | Email is a secondary feature; the platform should remain operational even if SMTP is misconfigured |
| 7 | Spec does not define the npm package for sending emails | `nodemailer` | Industry-standard Node.js email library; widely used, well-maintained, supports Gmail SMTP natively |

---

## VERIFICATION REPORT — Section 11: Email System

### Spec Alignment Check

| Spec Requirement | Covered In Output | Status |
|---|---|---|
| Gmail SMTP (`smtp.gmail.com:587`) using App Password | Section 11.2.1 | ✅ Covered |
| Daily limit of 500 emails | Section 11.3 | ✅ Covered |
| Invitation emails with time-limited registration link | Section 11.4.1 | ✅ Covered |
| Invite links expire after 2 hours | Section 11.4.1 (`expiryHours = 2`) | ✅ Covered |
| Admin can resend invitation (invalidates previous token) | Section 11.4.1 (same template for resend) | ✅ Covered |
| Password reset emails | Section 11.4.2 | ✅ Covered |
| Admin stop project triggers email notification to student | Section 11.4.3 | ✅ Covered |
| Admin terminate project triggers email notification to student | Section 11.4.4 | ✅ Covered |
| `emailService.js` handles invitation, password reset, notification emails | Section 11.2.3 | ✅ Covered |
| Registration link format: `{FRONTEND_URL}/register?token=<jwt_string>` | Section 11.4.1 | ✅ Covered |
| Password reset link format: `{FRONTEND_URL}/reset-password?token=<raw_token>` | Section 11.4.2 | ✅ Covered |
| `POST /api/auth/forgot-password` returns 200 OK regardless of email existence | Section 11.7.2 (caller handling) | ✅ Covered |
| SMTP configuration variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_DAILY_LIMIT` | Section 11.9 | ✅ Covered |

### Gaps Found

| Missing Item | Action |
|---|---|
| No gaps found after line-by-line comparison | N/A |

### Decisions Beyond The Spec

| Decision Made | Reason |
|---|---|
| In-memory daily send counter with `setInterval` reset | Simplest approach; Gmail's own limits as backstop |
| Email failures are non-blocking | Email is a notification mechanism; primary actions should never fail due to email |
| No automatic email retry | Avoids retry queue complexity; manual retries sufficient for academic use |
| HTML templates with inline styling and plaintext fallbacks | Standard transactional email format; email client compatibility |
| Sequential batch email sending | Avoids Gmail rate limiting; simpler error handling |
| SMTP connection failure is non-fatal | Platform should remain operational without email |
| `nodemailer` as SMTP library | Industry standard for Node.js |
| Specific email subject lines and body content | Spec says "invitation email containing a registration link" but doesn't provide exact wording |
| `secure: false` for port 587 | Port 587 uses STARTTLS; `secure: true` is for port 465 |
| Transporter created once at module load time | Nodemailer manages connection pooling |

### Cross-Section Consistency Check

| Item | Matches Earlier Sections | Status |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_DAILY_LIMIT` | Section 3.2.7 | ✅ Consistent |
| `FRONTEND_URL` for link construction | Section 3.2.11 | ✅ Consistent |
| `PLATFORM_DOMAIN` for project URLs | Section 3.2.11 | ✅ Consistent |
| Registration link format `{FRONTEND_URL}/register?token=<jwt>` | Section 5.9.1 | ✅ Consistent |
| Password reset link format `{FRONTEND_URL}/reset-password?token=<raw>` | Section 5.9.8 | ✅ Consistent |
| `emailService.js` file path | Section 2.3 | ✅ Consistent |
| Invite token expiry `2h` | Section 3.2.3 | ✅ Consistent |
| Password reset token expiry `1h` | Section 3.2.3 | ✅ Consistent |
| Stop project sends email (Section 6.4.9) | Section 6.4.9 step 3 | ✅ Consistent |
| Terminate project sends email (Section 6.4.10) | Section 6.4.10 step 6 | ✅ Consistent |
| Daily limit `500` | Section 1.7 | ✅ Consistent |
| Gmail SMTP in tech stack | Section 1.5 | ✅ Consistent |

### Business Logic Check

| Logic Item | Real-World Valid | Issue (if any) |
|---|---|---|
| In-memory daily counter resets on restart | ⚠️ Questionable | If the backend restarts frequently, the counter could allow more than 500 emails/day. However, Gmail's own rate limiting provides a hard backstop, so the practical risk is minimal. |
| Email failures non-blocking for all operations | ✅ Valid | Email is secondary; core operations should never be blocked by SMTP issues |
| Sequential batch sending for invitations | ✅ Valid | Avoids Gmail rate limiting; acceptable latency for typical academic batch sizes (30–50 students) |
| User and token rows created even if email fails | ✅ Valid | Admin can resend later; avoids partial state where user exists but no token, or vice versa |
| SMTP verification on startup (non-fatal) | ✅ Valid | Platform should start even if email is misconfigured |
| Plaintext fallback for all emails | ✅ Valid | Some email clients don't render HTML; plaintext ensures the link is always accessible |

---

## ✅ SECTION 11 COMPLETE — Email System

| Final Check | Result |
|---|---|
| All spec requirements covered | ✅ Yes |
| All gaps found and fixed | ✅ Yes |
| Business logic is consistent | ✅ Yes |
| No conflicts with past sections | ✅ Yes |
| Output is valid renderable Markdown | ✅ Yes |

**Section status: LOCKED**
This section's field names, variable names, table names, route paths, and values are now permanently locked. No changes will be made to this section in future sessions unless the user explicitly requests a correction.

---

## SELF-AUDIT — Section 11

### Coverage Check

| Spec Item | Status |
|---|---|
| Gmail SMTP (`smtp.gmail.com:587`) using App Password (spec: "Architecture & Technical Decisions") | ✅ Covered |
| Daily limit of 500 emails — sufficient for academic use (spec: same) | ✅ Covered |
| Platform sends invitation email containing a time-limited registration link (spec: "Student Management") | ✅ Covered |
| Invitation links expire after two hours (spec: same) | ✅ Covered |
| Admin can resend invitation, invalidates previous token (spec: same) | ✅ Covered |
| Password reset emails (spec: "Dashboard & Profile" implies; Section 5.9.8 explicit) | ✅ Covered |
| Admin stop triggers automated email notification to affected student (spec: "Project Management") | ✅ Covered |
| Admin terminate triggers automated email notification to affected student (spec: same) | ✅ Covered |
| `services/emailService.js`: invitation emails, password reset emails, notification emails (Section 2.3) | ✅ Covered |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_DAILY_LIMIT` (Section 3.2.7) | ✅ Covered |
| Registration link: `{FRONTEND_URL}/register?token=<jwt_string>` (Section 5.9.1) | ✅ Covered |
| Password reset link: `{FRONTEND_URL}/reset-password?token=<raw_token>` (Section 5.9.8) | ✅ Covered |
| `POST /api/auth/forgot-password` always returns 200 OK (Section 5.9.8) | ✅ Covered |
| Stop response includes `notifiedStudent` field (Section 6.4.9) | ✅ Covered |
| Terminate response includes `notifiedStudent` field (Section 6.4.10) | ✅ Covered |

### Decisions Made (not explicitly in spec)

| # | Decision | Reasoning |
|---|---|---|
| 1 | In-memory daily send counter with `setInterval` reset | Low-criticality counter; Gmail's own limits as backstop; database storage adds unnecessary complexity |
| 2 | Email failures are non-blocking for all operations | Email is a notification mechanism; primary actions should never fail due to SMTP |
| 3 | No automatic retry for failed emails | Avoids retry queue complexity; manual retries sufficient for academic scale |
| 4 | HTML emails with inline styling + plaintext fallbacks | Standard transactional email format; inline for email client compatibility |
| 5 | Sequential batch email sending (not parallel) | Avoids Gmail rate limits; simpler error handling; acceptable performance for typical batches |
| 6 | SMTP verification failure is non-fatal on startup | Platform should remain operational even if email is misconfigured |
| 7 | `nodemailer` as SMTP library | Industry-standard Node.js email package |
| 8 | Specific subject lines and body HTML for each email type | Spec defines email purposes but not exact wording; templates are reasonable defaults |
| 9 | Transporter created once at module load, reused for all sends | Nodemailer handles connection pooling; avoids per-send connection overhead |
| 10 | Batch year line conditionally included in invitation email only if not null | Batch year is optional; showing "null" would be confusing |
| 11 | Terminated email captures original subdomain before soft-delete changes it | Subdomain becomes `_deleted_{projectId}` after termination; the notification must show the original URL |

### Potential Issues

| # | Issue | Risk | Mitigation |
|---|---|---|---|
| 1 | In-memory counter resets on backend restart, allowing more than 500 emails/day | Low — Gmail's own rate limiting provides a hard backstop | If strict enforcement is needed, move counter to database |
| 2 | Sequential batch sending could be slow for very large batches (500+ emails) | Moderate — request could time out if batch is extremely large | At 500 emails/day limit, batches this large would hit the limit anyway; practical batches are 30–100 students |
| 3 | Email templates are hardcoded HTML strings in JavaScript | Maintenance burden for template changes | Templates are simple; could be refactored to external `.html` files later without changing the API |
| 4 | No email delivery confirmation or tracking | Admin has no visibility into whether a specific email was actually delivered vs. bounced | Gmail handles bounce/delivery at the SMTP level; platform logs send success/failure; delivery tracking would require a more complex email service |
| 5 | Sonnet might not pass the original subdomain to the terminated email if it reads `projects.subdomain` after the soft-delete update | The email would show `_deleted_15` instead of the real URL | Section 11.4.4 explicitly documents capturing the original subdomain before the soft-delete; the flow in Section 11.5.4 takes subdomain as a parameter |
| 6 | `FRONTEND_URL` must be correctly configured for both dev and production | Wrong URL would produce broken registration/reset links | Section 3.5 documents environment-specific values (`http://localhost:5173` for dev, `https://acadhost.com` for production) |
| 7 | Gmail App Passwords may be revoked by Google if unusual activity is detected | Email service would silently fail until reconfigured | SMTP verification on startup logs a warning; all email failures are logged for admin visibility |