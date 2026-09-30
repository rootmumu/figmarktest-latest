const nodemailer = require('nodemailer');

// Configure your SMTP transporter here
// In production, these should be environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: parseInt(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER || 'test@ethereal.email',
    pass: process.env.SMTP_PASS || 'password'
  }
});

const sendInitialPaymentReceipt = async (emails, project) => {
  if (!emails || emails.length === 0) return;

  const mailOptions = {
    from: process.env.SMTP_FROM || '"PMS Finance" <finance@pms.com>',
    to: emails.join(', '),
    subject: `Payment Receipt: Initial Payment for ${project.title}`,
    html: `
      <h2>Initial Payment Received</h2>
      <p>Dear Student(s),</p>
      <p>We have successfully received the initial payment for your project: <strong>${project.title}</strong>.</p>
      <ul>
        <li><strong>Total Project Cost:</strong> ₹${project.totalCost}</li>
        <li><strong>Initial Amount Paid:</strong> ₹${project.initialAmount}</li>
        <li><strong>Payment Date:</strong> ${new Date(project.initialPaymentDate).toLocaleDateString()}</li>
        ${project.emiSchedule && project.emiSchedule.length > 0 ? `<li><strong>Next EMI Due Date:</strong> ${new Date(project.emiSchedule[0].dueDate).toLocaleDateString()}</li>` : ''}
      </ul>
      <p>Your EMI schedule has been generated.Pay the amount on time.</p>
      <br/>
      <p>Regards,</p>
      <p>Accounts Department</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Initial payment email sent to ${emails.join(', ')}`);
  } catch (error) {
    console.error('Error sending initial payment email:', error);
  }
};

const sendEmiReminder = async (emails, project, emiDetail) => {
  if (!emails || emails.length === 0) return;

  const mailOptions = {
    from: process.env.SMTP_FROM || '"PMS Finance" <finance@pms.com>',
    to: emails.join(', '),
    subject: `EMI Reminder: Upcoming Payment for ${project.title}`,
    html: `
      <h2>EMI Payment Reminder</h2>
      <p>Dear Student(s),</p>
      <p>This is a gentle reminder that an EMI payment for your project <strong>${project.title}</strong> is due soon.</p>
      <ul>
        <li><strong>Amount Due:</strong> ₹${emiDetail.amount}</li>
        <li><strong>Due Date:</strong> ${new Date(emiDetail.dueDate).toLocaleDateString()}</li>
      </ul>
      <p>Kindly ensure that your payment is made on or before the due date.</p>
      <br/>
      <p>Regards,</p>
      <p>Accounts Department</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`EMI reminder email sent to ${emails.join(', ')}`);
  } catch (error) {
    console.error('Error sending EMI reminder email:', error);
  }
};

const sendEmiPaymentReceipt = async (emails, project, paymentAmount, nextEmi) => {
  if (!emails || emails.length === 0) return;

  let nextDueDateHtml = '';
  if (nextEmi) {
    nextDueDateHtml = `<li><strong>Next EMI Due Date:</strong> ${new Date(nextEmi.dueDate).toLocaleDateString()}</li>`;
  } else {
    nextDueDateHtml = `<li><strong>Next EMI Due Date:</strong> All EMIs Paid</li>`;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || '"PMS Finance" <finance@pms.com>',
    to: emails.join(', '),
    subject: `Payment Receipt: EMI Installment for ${project.title}`,
    html: `
      <h2>EMI Payment Received</h2>
      <p>Dear Student(s),</p>
      <p>We have successfully received an EMI payment for your project: <strong>${project.title}</strong>.</p>
      <ul>
        <li><strong>Amount Paid:</strong> ₹${paymentAmount}</li>
        <li><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</li>
        ${nextDueDateHtml}
      </ul>
      <p>You can view your complete payment history in your dashboard.</p>
      <br/>
      <p>Regards,</p>
      <p>Accounts Department</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`EMI payment receipt email sent to ${emails.join(', ')}`);
  } catch (error) {
    console.error('Error sending EMI payment receipt email:', error);
  }
};

const sendOtpEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || '"PMS Security" <security@pms.com>',
    to: email,
    subject: `Password Reset OTP`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password. Here is your One-Time Password (OTP):</p>
        <div style="font-size: 24px; font-weight: bold; padding: 10px; margin: 20px 0; background-color: #f4f4f4; border-radius: 5px; text-align: center; letter-spacing: 5px;">
          ${otp}
        </div>
        <p>This OTP is valid for 10 minutes. If you did not request a password reset, please ignore this email.</p>
        <br/>
        <p>Regards,</p>
        <p>PMS Security Team</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP email sent to ${email}`);
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw error;
  }
};

const sendBatchWorklogReminderEmail = async (missingUsers, dateFormatted) => {
  if (!missingUsers || missingUsers.length === 0) return;

  const recipientEmails = missingUsers.map(u => u.email).filter(Boolean);
  if (recipientEmails.length === 0) return;

  const mailOptions = {
    from: process.env.SMTP_FROM || '"FIGMARK PMS Operations" <figmarkpms@gmail.com>',
    replyTo: process.env.SMTP_USER || 'figmarkpms@gmail.com',
    to: process.env.SMTP_USER || 'figmarkpms@gmail.com',
    bcc: recipientEmails,
    subject: `Daily Worklog Reminder - ${dateFormatted}`,
    text: `Hello Team,\n\nThis is a friendly automated reminder that your daily worklog for today (${dateFormatted}) has not been submitted yet.\n\nPlease update your worklog details at: http://localhost:5173/worklog\n\nRegards,\nFIGMARK PMS Automated Notification System`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0; font-size: 20px;">Daily Worklog Reminder</h2>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hello Team Member,</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">This is a friendly automated reminder that your daily worklog for today (<strong>${dateFormatted}</strong>) has not been submitted yet.</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Please take a moment to update your worklog details before completing your day's work.</p>
        
        <div style="margin: 28px 0; text-align: center;">
          <a href="http://localhost:5173/worklog" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">Submit Daily Worklog</a>
        </div>

        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">If you have already submitted your worklog, please disregard this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">Project Management System — Automated Reminder System</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Batched worklog reminder email successfully sent to ${recipientEmails.length} team members in 1 SMTP request!`);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log(`🔗 Ethereal Test Email Preview URL: ${previewUrl}`);
  } catch (error) {
    console.error('Error sending batched worklog reminder email:', error);
  }
};

const sendWorklogReminderEmail = async (email, userName, dateFormatted) => {
  if (!email) return;

  const mailOptions = {
    from: process.env.SMTP_FROM || '"FIGMARK PMS Operations" <figmarkpms@gmail.com>',
    replyTo: process.env.SMTP_USER || 'figmarkpms@gmail.com',
    to: email,
    subject: `Daily Worklog Reminder - ${dateFormatted}`,
    text: `Dear ${userName},\n\nThis is a friendly automated reminder that your daily worklog for today (${dateFormatted}) has not been submitted yet.\n\nPlease update your worklog details at: http://localhost:5173/worklog\n\nRegards,\nFIGMARK PMS Automated Notification System`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0; font-size: 20px;">Daily Worklog Reminder</h2>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Dear <strong>${userName}</strong>,</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">This is a friendly automated reminder that your daily worklog for today (<strong>${dateFormatted}</strong>) has not been submitted yet.</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Please take a moment to update your worklog details before completing your day's work.</p>
        
        <div style="margin: 28px 0; text-align: center;">
          <a href="http://localhost:5173/worklog" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">Submit Daily Worklog</a>
        </div>

        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">If you have already submitted your worklog, please disregard this email.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">Project Management System — Automated Reminder System</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Worklog reminder email successfully sent to ${userName} <${email}>`);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log(`🔗 Ethereal Test Email Preview URL: ${previewUrl}`);
  } catch (error) {
    console.error(`Error sending worklog reminder email to ${email}:`, error);
  }
};

const sendDailyWorklogSummaryToAdmins = async (adminEmails, missingUsers, dateFormatted) => {
  if (!adminEmails || adminEmails.length === 0) return;

  let missingListHtml = '';
  let missingListText = '';

  if (missingUsers && missingUsers.length > 0) {
    missingListText = missingUsers.map((u, i) => `${i + 1}. ${u.name} (${u.role || 'Employee'}) - ${u.email || 'N/A'}`).join('\n');
    missingListHtml = `
      <p style="color: #334155; font-size: 15px;">The following <strong>${missingUsers.length}</strong> team member(s) have not submitted their worklog for today (<strong>${dateFormatted}</strong>):</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
        <thead>
          <tr style="background-color: #f1f5f9; text-align: left;">
            <th style="padding: 10px; border: 1px solid #cbd5e1;">#</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Name</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Role</th>
            <th style="padding: 10px; border: 1px solid #cbd5e1;">Email</th>
          </tr>
        </thead>
        <tbody>
          ${missingUsers.map((u, i) => `
            <tr>
              <td style="padding: 10px; border: 1px solid #cbd5e1;">${i + 1}</td>
              <td style="padding: 10px; border: 1px solid #cbd5e1;"><strong>${u.name}</strong></td>
              <td style="padding: 10px; border: 1px solid #cbd5e1;">${u.role || 'Employee'}</td>
              <td style="padding: 10px; border: 1px solid #cbd5e1;">${u.email || 'N/A'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    missingListText = `All active team members have submitted their worklogs for today (${dateFormatted})!`;
    missingListHtml = `
      <div style="padding: 16px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; color: #166534; font-size: 15px; margin-top: 16px;">
        🎉 <strong>All active team members have submitted their worklogs for today (${dateFormatted})!</strong>
      </div>
    `;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || '"FIGMARK PMS Operations" <figmarkpms@gmail.com>',
    replyTo: process.env.SMTP_USER || 'figmarkpms@gmail.com',
    to: adminEmails.join(', '),
    subject: `Daily Worklog Report: ${dateFormatted}`,
    text: `Hello Admin / HR,\n\nDaily Worklog Submission Report for ${dateFormatted}:\n\n${missingListText}\n\nDashboard: http://localhost:5173/worklog\n\nFIGMARK PMS Automated Reporting`,
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
          <h2 style="color: #1e293b; margin: 0; font-size: 20px;">Daily Worklog Submission Report</h2>
        </div>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hello Admin / HR,</p>
        <p style="color: #334155; font-size: 15px; line-height: 1.6;">Here is the daily worklog submission status for <strong>${dateFormatted}</strong>:</p>
        
        ${missingListHtml}

        <div style="margin: 28px 0; text-align: center;">
          <a href="http://localhost:5173/worklog" style="background-color: #4f46e5; color: #ffffff; padding: 12px 24px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">View Worklog Dashboard</a>
        </div>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">Project Management System — Automated Operations Reporting</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Daily worklog summary email successfully sent to Admins/HR (${adminEmails.join(', ')})`);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) console.log(`🔗 Ethereal Admin Summary Email Preview URL: ${previewUrl}`);
  } catch (error) {
    console.error('Error sending daily worklog summary email to Admins/HR:', error);
  }
};

module.exports = {
  sendInitialPaymentReceipt,
  sendEmiReminder,
  sendEmiPaymentReceipt,
  sendOtpEmail,
  sendWorklogReminderEmail,
  sendBatchWorklogReminderEmail,
  sendDailyWorklogSummaryToAdmins
};


