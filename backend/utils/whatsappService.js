/**
 * WhatsApp Group Reminder Service
 * Sends automated group reminders to WhatsApp API (UltraMsg, Green API, Twilio, or custom webhooks)
 */

const sendWhatsAppGroupMessage = async (messageText) => {
  const apiUrl = process.env.WHATSAPP_API_URL;
  const token = process.env.WHATSAPP_TOKEN;
  const groupId = process.env.WHATSAPP_GROUP_ID;

  if (!apiUrl) {
    console.log('[WhatsApp Service] WHATSAPP_API_URL is not configured in .env. Skipping WhatsApp group reminder.');
    return { success: false, reason: 'WHATSAPP_API_URL not configured' };
  }

  try {
    const payload = {
      token: token || undefined,
      to: groupId || undefined,
      chatId: groupId || undefined,
      group_id: groupId || undefined,
      body: messageText,
      message: messageText,
      caption: messageText
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (token && !apiUrl.includes('token=')) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[WhatsApp Service] Sending daily reminder to WhatsApp group via API: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({ status: response.status, text: response.statusText }));
    console.log('[WhatsApp Service] WhatsApp API Response:', result);
    return { success: response.ok, data: result };
  } catch (error) {
    console.error('[WhatsApp Service] Failed to send WhatsApp message:', error.message);
    return { success: false, error: error.message };
  }
};

const sendWorklogWhatsAppGroupReminder = async (missingUsers, dateFormatted) => {
  let message = `📢 *DAILY WORKLOG REMINDER* 📢\n\n`;
  message += `🗓 *Date:* ${dateFormatted}\n`;
  message += `⏰ *Time:* 5:00 PM\n\n`;

  if (missingUsers && missingUsers.length > 0) {
    message += `⚠️ *Gentle reminder for the following team members who have not submitted their worklog today:*\n\n`;
    missingUsers.forEach((u, i) => {
      message += `  ${i + 1}. *${u.name}* (${u.role || 'Team Member'})\n`;
    });
    message += `\n📌 Please update your daily worklog before completing your day.\n`;
  } else {
    message += `🎉 *All team members have submitted their worklogs for today! Great job team!* 👏\n`;
  }

  message += `\n🔗 *Submit Worklog:* http://localhost:5173/worklog\n\n`;
  message += `_This is an automated daily reminder from Project Management System._`;

  return await sendWhatsAppGroupMessage(message);
};

module.exports = {
  sendWhatsAppGroupMessage,
  sendWorklogWhatsAppGroupReminder
};
