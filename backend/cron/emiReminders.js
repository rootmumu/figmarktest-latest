const cron = require('node-cron');
const Project = require('../models/Project');
const { sendEmiReminder } = require('../utils/mailer');

// Run every day at 8:00 AM
cron.schedule('0 8 * * *', async () => {
  console.log('Running EMI reminders cron job...');
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 5); // 5 days from today

    // Find academic projects with pending EMIs
    const projects = await Project.find({
      type: 'academic',
      'emiSchedule.status': 'Pending'
    });

    for (const project of projects) {
      for (const emi of project.emiSchedule) {
        if (emi.status === 'Pending' && emi.dueDate) {
          const emiDueDate = new Date(emi.dueDate);
          emiDueDate.setHours(0, 0, 0, 0);

          // If due date is exactly 5 days from today
          if (emiDueDate.getTime() === targetDate.getTime()) {
            const emails = (project.assignedMembers || [])
              .map(m => m.email)
              .filter(e => e);

            if (emails.length > 0) {
              await sendEmiReminder(emails, project, emi);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in EMI reminders cron job:', error);
  }
});
