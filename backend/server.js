const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
require('dotenv').config();
require('./cron/emiReminders');
require('./cron/worklogReminders');


// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
  console.log('Created missing uploads directory');
}

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Store io in app state
app.set('socketio', io);

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log('Socket client connected:', socket.id);

  socket.on('register', ({ userId, role }) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`Socket ${socket.id} joined room for user: ${userId}`);
    }
    if (role) {
      socket.join(role);
      console.log(`Socket ${socket.id} joined room for role: ${role}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket client disconnected:', socket.id);
  });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Dynamic Decompression serving for uploaded files
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  const compressedPath = filePath + '.gz';

  if (fs.existsSync(compressedPath)) {
    fs.readFile(compressedPath, (err, data) => {
      if (err) {
        return res.status(500).json({ message: 'Error reading file' });
      }
      zlib.gunzip(data, (err, decompressedData) => {
        if (err) {
          return res.status(500).json({ message: 'Error decompressing file' });
        }
        const mimeTypes = {
          '.pdf': 'application/pdf',
          '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.zip': 'application/zip',
          '.rar': 'application/vnd.rar',
          '.txt': 'text/plain',
          '.csv': 'text/csv',
          '.json': 'application/json'
        };
        const ext = path.extname(filename).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.send(decompressedData);
      });
    });
  } else if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'File not found' });
  }
});

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/projects', require('./routes/projectRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/worklogs', require('./routes/worklogRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/activities', require('./routes/activityRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/meetings', require('./routes/meetingRoutes'));
app.use('/api/weekly-plans', require('./routes/weeklyPlanRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));

// WhatsApp Bot QR Code / Status Route
app.get('/api/whatsapp/qr', (req, res) => {
  const { getCurrentQrData } = require('./utils/whatsappBot');
  const data = getCurrentQrData();
  if (process.env.ENABLE_WHATSAPP_BOT !== 'true') {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Notification Status</title></head>
      <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #fff;">
        <div style="background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 50px; margin-bottom: 10px;">📧</div>
          <h2>Email Reminder Method Active</h2>
          <p style="color: #94a3b8;">Daily worklog reminders are sent via SMTP Email to individual team members & Admins.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (data.clientReady) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>WhatsApp Bot Status</title></head>
      <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: #fff;">
        <div style="background: #1e293b; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size: 50px; margin-bottom: 10px;">✅</div>
          <h2>WhatsApp Bot Connected!</h2>
          <p style="color: #94a3b8;">Your WhatsApp Web Bot is authenticated and ready to send daily worklog reminders.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (fs.existsSync(data.qrImagePath)) {
    return res.sendFile(data.qrImagePath);
  }

  return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;"><h2>⏳ Generating QR Code...</h2><p>Please refresh in a few seconds.</p><script>setTimeout(() => location.reload(), 3000);</script></body></html>`);
});

app.post(['/api/test-worklog-remind', '/api/test-whatsapp-remind'], async (req, res) => {
  const { checkAndSendWorklogReminders } = require('./cron/worklogReminders');
  try {
    await checkAndSendWorklogReminders();
    res.json({ success: true, message: 'Worklog email reminders triggered successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB via Mongoose');
    try {
      const Notification = require('./models/Notification');
      const Project = require('./models/Project');
      const notifications = await Notification.find({ $or: [{ link: '' }, { link: null }, { link: { $exists: false } }] });
      console.log(`Running notification link migration for ${notifications.length} records...`);
      for (const notif of notifications) {
        let projectTitle = '';
        const matchQuotes = notif.message.match(/project\s+"([^"]+)"/i);
        const matchUpdate = notif.message.match(/Project Update\s*\(([^)]+)\)/i);
        const matchColon = notif.message.match(/project:\s*([A-Za-z0-9\s\-]+?)(:|$)/i);
        const matchPreposition = notif.message.match(/(?:in|for|from|to)\s+project\s+([A-Za-z0-9\s\-]+?)(:|$)/i);
        if (matchQuotes) {
          projectTitle = matchQuotes[1];
        } else if (matchUpdate) {
          projectTitle = matchUpdate[1];
        } else if (matchColon) {
          projectTitle = matchColon[1].trim();
        } else if (matchPreposition) {
          projectTitle = matchPreposition[1].trim();
        }
        if (projectTitle) {
          const escapedTitle = projectTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const project = await Project.findOne({ title: new RegExp(`^${escapedTitle}$`, 'i') });
          if (project) {
            let link = `/project-details/${project._id}`;
            let issueTitlePart = '';
            const parts = notif.message.split(':');
            if (parts.length > 1) {
              issueTitlePart = parts[parts.length - 1].trim();
            }
            if (issueTitlePart) {
              const cleanIssueTitle = issueTitlePart.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();
              if (cleanIssueTitle && !cleanIssueTitle.includes('project') && !cleanIssueTitle.includes('timeline')) {
                const issue = project.issues.find(i =>
                  (i.title || '').toLowerCase().includes(cleanIssueTitle) ||
                  cleanIssueTitle.includes((i.title || '').toLowerCase())
                );
                if (issue) {
                  link += `?highlightIssue=${issue._id}`;
                }
              }
            }
            notif.link = link;
            await notif.save();
          }
        } else if (notif.message.toLowerCase().includes('low stock alert')) {
          const matchItem = notif.message.match(/Low Stock Alert:\s*([A-Za-z0-9\s\-]+?)\s*is/i);
          if (matchItem) {
            notif.link = `/inventory-dashboard?search=${encodeURIComponent(matchItem[1].trim())}`;
            await notif.save();
          }
        } else if (notif.message.toLowerCase().includes('inventory request approved')) {
          notif.link = `/inventory-records`;
          await notif.save();
        } else if (notif.message.toLowerCase().includes('component request was approved') || notif.message.toLowerCase().includes('component request was rejected')) {
          notif.link = `/inventory-dashboard`;
          await notif.save();
        }
      }
      console.log('Notification link migration completed.');

      // Auto-restore passwords for users corrupted by the previous edit bug
      const bcrypt = require('bcryptjs');
      const User = require('./models/User');
      const corruptedUsers = await User.find({ $or: [{ password: '' }, { password: null }, { password: { $exists: false } }] });
      if (corruptedUsers.length > 0) {
        console.log(`Restoring passwords for ${corruptedUsers.length} corrupted user records...`);
        const salt = await bcrypt.genSalt(10);
        const restoredHash = await bcrypt.hash('123456', salt);
        for (const u of corruptedUsers) {
          u.password = restoredHash;
          await u.save();
          console.log(`Restored password to '123456' for user: ${u.email}`);
        }
      }

      // Auto-run EMI & Deadline reminders check on boot
      const { checkEmiReminders, checkDeadlineReminders } = require('./controllers/projectController');
      checkEmiReminders(app);
      checkDeadlineReminders(app);

      // Schedule it to run every 24 hours for EMI
      setInterval(() => {
        checkEmiReminders(app);
      }, 24 * 60 * 60 * 1000);

      // Schedule checkDeadlineReminders to run daily at exactly 10:00 AM
      const scheduleDaily10AMCheck = () => {
        const now = new Date();
        const target = new Date(now);
        target.setHours(10, 0, 0, 0);
        if (now > target) {
          target.setDate(target.getDate() + 1); // target 10 AM tomorrow
        }
        const delay = target.getTime() - now.getTime();
        setTimeout(() => {
          checkDeadlineReminders(app);
          // After the first run at 10 AM, repeat every 24 hours
          setInterval(() => {
            checkDeadlineReminders(app);
          }, 24 * 60 * 60 * 1000);
        }, delay);
      };

      scheduleDaily10AMCheck();

    } catch (migErr) {
      console.error('Error migrating notification links:', migErr);
    }
  })
  .catch(err => console.error('Failed to connect to MongoDB', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

