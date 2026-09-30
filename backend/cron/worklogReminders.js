const cron = require('node-cron');
const User = require('../models/User');
const Worklog = require('../models/Worklog');
const { sendWorklogReminderEmail, sendBatchWorklogReminderEmail, sendDailyWorklogSummaryToAdmins } = require('../utils/mailer');

const checkAndSendWorklogReminders = async (forceTrigger = false, targetDate = null) => {
  console.log('[Worklog Reminders] Running worklog reminder check...');
  try {
    const refDate = targetDate ? new Date(targetDate) : new Date();
    const todayStart = new Date(refDate);

    // Sunday Holiday Check (0 = Sunday)
    if (todayStart.getDay() === 0 && !forceTrigger) {
      console.log('[Worklog Reminders] Today is Sunday (Holiday). Skipping automated worklog reminders.');
      return;
    }

    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(refDate);
    todayEnd.setHours(23, 59, 59, 999);

    // 1. Fetch active users eligible for worklog submission (Employees and Team Leads)
    const activeUsers = await User.find({
      status: 'Active',
      role: { $in: ['Employee', 'TeamLead'] }
    }).select('_id name email role');

    if (!activeUsers || activeUsers.length === 0) {
      console.log('[Worklog Reminders] No active employees/team leads found for worklog reminders.');
      return;
    }

    // 2. Find worklogs submitted today
    const submittedWorklogs = await Worklog.find({
      date: { $gte: todayStart, $lte: todayEnd }
    }).select('employee');

    const submittedUserIds = new Set(
      submittedWorklogs.map(w => w.employee ? w.employee.toString() : null).filter(Boolean)
    );

    // 3. Filter users who have NOT submitted a worklog today
    const missingUsers = activeUsers.filter(user => !submittedUserIds.has(user._id.toString()));

    console.log(`[Worklog Reminders] Found ${missingUsers.length} user(s) missing today's worklog out of ${activeUsers.length} total active users.`);

    const formattedDate = todayStart.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // 4. Send batched email reminder to all missing users in 1 single SMTP request (conserving quota)
    if (missingUsers.length > 0) {
      console.log(`[Worklog Reminders] Batch sending reminder email to ${missingUsers.length} team member(s)...`);
      await sendBatchWorklogReminderEmail(missingUsers, formattedDate);
    }

    // 5. Send consolidated daily worklog report email to Admins / HR
    const adminUsers = await User.find({
      status: 'Active',
      role: { $in: ['Admin', 'HR'] }
    }).select('email');

    const adminEmails = adminUsers.map(u => u.email).filter(Boolean);
    if (adminEmails.length > 0) {
      console.log(`[Worklog Reminders] Sending daily summary report to ${adminEmails.length} Admin/HR user(s)...`);
      await sendDailyWorklogSummaryToAdmins(adminEmails, missingUsers, formattedDate);
    }

    console.log('[Worklog Reminders] Daily worklog email reminder processing completed.');
  } catch (error) {
    console.error('[Worklog Reminders] Error in daily worklog reminder job:', error);
  }
};

// Schedule automated execution Monday through Saturday at 5:00 PM (1-6, skipping Sunday)
cron.schedule('0 17 * * 1-6', async () => {
  console.log('[Cron Schedule] Triggering automated 5:00 PM worklog reminder via Mail...');
  await checkAndSendWorklogReminders();
});

module.exports = {
  checkAndSendWorklogReminders
};

