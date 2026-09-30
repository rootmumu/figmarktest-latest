const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

let clientReady = false;
let currentQrDataUrl = null;

const qrImagePath = path.join(__dirname, '..', 'whatsapp-qr.png');

// Auto-detect local Chrome installation on Windows or Linux/Mac
const getExecutablePath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const defaultChromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser'
  ];
  for (const path of defaultChromePaths) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  return undefined;
};

const executablePath = getExecutablePath();
if (executablePath) {
  console.log(`[WhatsApp Bot] Using browser executable at: ${executablePath}`);
}

// Initialize WhatsApp Web client with LocalAuth (persists login QR scan)
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  },
  puppeteer: {
    headless: false,
    executablePath: executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote'
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  }
});

client.on('qr', async (qr) => {
  console.log('\n======================================================');
  console.log('📲 NEW WHATSAPP BOT QR CODE GENERATED!');
  console.log('======================================================\n');
  
  // Print terminal QR
  qrcodeTerminal.generate(qr, { small: true });

  try {
    // Generate crisp PNG image file for easy phone scanning
    await QRCode.toFile(qrImagePath, qr, {
      width: 400,
      margin: 2
    });
    currentQrDataUrl = await QRCode.toDataURL(qr);
    console.log(`📸 Saved clean QR Code image to file: ${qrImagePath}`);
    console.log(`🌐 You can view it in your browser at: http://localhost:5000/api/whatsapp/qr\n`);
  } catch (err) {
    console.error('Error generating PNG QR Code image:', err);
  }
});

client.on('ready', () => {
  clientReady = true;
  currentQrDataUrl = null;
  // Remove temp QR image when connected
  if (fs.existsSync(qrImagePath)) {
    try { fs.unlinkSync(qrImagePath); } catch (e) {}
  }
  console.log('✅ WhatsApp Web Bot Client is connected and ready to send messages!');
});

client.on('authenticated', () => {
  console.log('🔒 WhatsApp Bot authenticated successfully.');
  setTimeout(() => {
    clientReady = true;
    console.log('✅ WhatsApp Web Bot Client ready flag active.');
  }, 3000);
});

client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp Bot authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  clientReady = false;
  console.log('⚠️ WhatsApp Bot disconnected:', reason);
});

// Initialize client asynchronously only if explicitly enabled in .env
if (process.env.ENABLE_WHATSAPP_BOT === 'true') {
  try {
    client.initialize();
  } catch (err) {
    console.error('Error initializing WhatsApp Bot client:', err);
  }
} else {
  console.log('[WhatsApp Bot] Disabled. Reminders will be dispatched via Mail.');
}

const getCurrentQrData = () => {
  return {
    clientReady,
    qrImagePath,
    currentQrDataUrl,
    hasImage: fs.existsSync(qrImagePath)
  };
};

/**
 * Send worklog reminder message to WhatsApp group(s)
 */
const sendWhatsAppGroupWorklogReminder = async (missingUsers, dateFormatted) => {
  if (!clientReady) {
    console.log('⏳ Waiting up to 30 seconds for WhatsApp Bot connection to be fully ready...');
    for (let i = 0; i < 30; i++) {
      if (clientReady) break;
      await new Promise(res => setTimeout(res, 1000));
    }
  }

  if (!clientReady) {
    console.log('⚠️ WhatsApp Bot is not connected/ready yet. Please ensure QR code is scanned.');
    return { success: false, reason: 'Client not ready' };
  }

  try {
    const rawGroupConfig = process.env.WHATSAPP_GROUP_NAME || '';
    const targetGroupNames = rawGroupConfig
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(Boolean);

    if (client.pupPage) {
      try {
        console.log('🌐 Current Puppeteer Page URL:', await client.pupPage.url());
        const screenshotPath = require('path').join(__dirname, '..', 'scratch_wa_page.png');
        await client.pupPage.screenshot({ path: screenshotPath });
        console.log('📸 Captured Puppeteer Page screenshot to:', screenshotPath);
      } catch (err) {
        console.error('Screenshot error:', err.message);
      }
    }

    let chats = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        chats = await client.getChats();
      } catch (err) {}

      if (!chats || chats.length === 0) {
        try {
          chats = await client.pupPage.evaluate(() => {
            if (window.Store && window.Store.Chat && window.Store.Chat.models) {
              return window.Store.Chat.models.map(c => ({
                id: c.id ? c.id._serialized : c.id,
                name: c.name || c.formattedTitle || (c.contact ? c.contact.name : '') || '',
                isGroup: c.isGroup || (c.id && c.id._serialized && c.id._serialized.endsWith('@g.us'))
              }));
            }
            return [];
          });
        } catch (err) {}
      }

      if (chats && chats.length > 0) {
        console.log(`📱 Synced ${chats.length} total chats from WhatsApp!`);
        break;
      }

      console.log(`⏳ Waiting for WhatsApp Web chat store sync (Attempt ${attempt}/6)...`);
      await new Promise(res => setTimeout(res, 4000));
    }

    console.log('📋 Available WhatsApp Chats:', chats.map(c => ({ name: c.name, isGroup: c.isGroup })));

    const groupChats = chats.filter(chat => chat.isGroup);

    if (groupChats.length === 0) {
      console.log('⚠️ No WhatsApp groups found for this account.');
      return { success: false, reason: 'No WhatsApp groups found' };
    }

    let targetChats = groupChats;
    if (targetGroupNames.length > 0) {
      targetChats = groupChats.filter(chat =>
        targetGroupNames.some(target => chat.name.toLowerCase().includes(target))
      );
      if (targetChats.length === 0) {
        console.log(`⚠️ No groups matching "${rawGroupConfig}" found. Sending to all available groups.`);
        targetChats = groupChats;
      }
    }

    let message = `📢 *DAILY WORKLOG REMINDER* 📢\n\n`;
    message += `🗓 *Date:* ${dateFormatted}\n`;
    message += `⏰ *Time:* 4:36 PM\n\n`;

    if (missingUsers && missingUsers.length > 0) {
      message += `⚠️ *Gentle reminder for team members who have not submitted their worklog today:*\n\n`;
      missingUsers.forEach((u, i) => {
        message += `  ${i + 1}. *${u.name}* (${u.role || 'Team Member'})\n`;
      });
      message += `\n📌 Please update your daily worklog before completing your day.\n`;
    } else {
      message += `🎉 *All team members have submitted their worklogs for today! Great job team!* 👏\n`;
    }

    message += `\n🔗 *Submit Worklog:* http://localhost:5173/worklog\n\n`;
    message += `_Automated Daily Reminder from Project Management System_`;

    for (const group of targetChats) {
      console.log(`[WhatsApp Bot] Sending daily worklog reminder to WhatsApp group: "${group.name}"`);
      await group.sendMessage(message);
    }

    return { success: true, count: targetChats.length };
  } catch (error) {
    console.error('Error sending WhatsApp group worklog reminder message:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  client,
  getCurrentQrData,
  sendWhatsAppGroupWorklogReminder
};
