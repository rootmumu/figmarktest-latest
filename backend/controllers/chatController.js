const User = require('../models/User');
const Project = require('../models/Project');
const Worklog = require('../models/Worklog');
const Meeting = require('../models/Meeting');
const WeeklyPlan = require('../models/WeeklyPlan');
const InventoryItem = require('../models/InventoryItem');

/**
 * Intelligent PMS AI Assistant Controller
 * Processes user queries against real-time PMS MongoDB data
 */
exports.handleChatMessage = async (req, res) => {
  try {
    const { message, history } = req.body;
    const user = req.user;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message text is required' });
    }

    const msg = message.trim().toLowerCase();
    const isPrivileged = ['Admin', 'HR'].includes(user.role);
    let reply = '';

    // ── 1. Overdue Inquiry (Projects, Deadlines, EMI) ────────────────
    if (
      msg.includes('overdue') ||
      msg.includes('delayed') ||
      msg.includes('late') ||
      msg.includes('missed deadline') ||
      msg.includes('past deadline')
    ) {
      const now = new Date();
      let projectFilter = {
        status: { $nin: ['completed', 'cancelled'] },
        deadline: { $exists: true, $ne: null, $lt: now }
      };

      if (!isPrivileged) {
        projectFilter.$or = [
          { 'assignedEmployees.employeeId': user._id },
          { teamLead: user._id },
          { teamLeads: user._id }
        ];
      }

      const overdueProjects = await Project.find(projectFilter)
        .populate('teamLead', 'name')
        .populate('teamLeads', 'name')
        .sort({ deadline: 1 });

      if (overdueProjects.length > 0) {
        const list = overdueProjects.map((p, idx) => {
          const d = new Date(p.deadline);
          const diffDays = Math.max(1, Math.ceil((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
          const tlName = (p.teamLead && p.teamLead.name) ? p.teamLead.name : (p.teamLeads && p.teamLeads.length > 0 ? p.teamLeads.map(t => t.name).join(', ') : 'Unassigned');
          return `${idx + 1}. **${p.title}**\n   - Deadline: **${d.toLocaleDateString('en-IN')}** (⚠️ **${diffDays} day(s) overdue**)\n   - Status: **${(p.status || 'Pending').toUpperCase()}** | Priority: **${(p.priority || 'Medium').toUpperCase()}**\n   - Team Lead: **${tlName}**`;
        }).join('\n\n');

        reply = `⚠️ **Found ${overdueProjects.length} Overdue Project(s):**\n\n${list}\n\n*Tip: You can review details or update deadlines in the Project Details tab.*`;
      } else {
        reply = isPrivileged
          ? `🎉 **Great news! There are currently no overdue projects across the company.** All active projects are within their target deadlines.`
          : `🎉 **You have no overdue projects assigned to you!** All your active project deadlines are on track.`;
      }
    }

    // ── 2. HR Inquiry ────────────────────────────────────────────────
    else if (
      msg.includes('hr') ||
      msg.includes('human resource') ||
      msg.includes('personnel')
    ) {
      const hrUsers = await User.find({ role: 'HR', status: 'Active' }).select('name email contactNumber phone department designation');
      if (hrUsers && hrUsers.length > 0) {
        const hrList = hrUsers.map(h => {
          const contact = h.contactNumber || h.phone || 'N/A';
          const dept = h.department ? ` (${h.department})` : '';
          return `• **${h.name}**${dept}\n  - Email: **${h.email}**\n  - Contact: **${contact}**`;
        }).join('\n\n');
        reply = `Here is the contact information for our **HR Department**:\n\n${hrList}\n\nYou can reach out to them directly for HR-related queries, onboarding, and project permissions.`;
      } else {
        reply = `There are currently no active **HR** profiles configured in the system. Please contact the System Administrator.`;
      }
    }

    // ── 3. Admin Inquiry ─────────────────────────────────────────────
    else if (
      msg.includes('admin') ||
      msg.includes('administrator') ||
      msg.includes('system admin')
    ) {
      const admins = await User.find({ role: 'Admin', status: 'Active' }).select('name email contactNumber phone');
      if (admins && admins.length > 0) {
        const adminList = admins.map(a => {
          const contact = a.contactNumber || a.phone || 'N/A';
          return `• **${a.name}**\n  - Email: **${a.email}**\n  - Contact: **${contact}**`;
        }).join('\n\n');
        reply = `Here are the **System Administrators**:\n\n${adminList}`;
      } else {
        reply = `No active Administrator found.`;
      }
    }

    // ── 4. Team Lead Inquiry ─────────────────────────────────────────
    else if (
      msg.includes('team lead') ||
      msg.includes('team leader') ||
      msg.includes('supervisor') ||
      msg.includes(' tl') ||
      msg === 'tl'
    ) {
      const teamLeads = await User.find({ role: 'TeamLead', status: 'Active' }).select('name email department contactNumber');
      if (teamLeads && teamLeads.length > 0) {
        const tlList = teamLeads.map(t => `• **${t.name}** - ${t.department || 'General'} (Email: ${t.email})`).join('\n');
        reply = `Here are the active **Team Leaders** across departments:\n\n${tlList}`;
      } else {
        reply = `No active Team Leads registered in the system.`;
      }
    }

    // ── 5. Project Inquiry (List, Assigned, Status) ──────────────────
    else if (
      msg.includes('project') ||
      msg.includes('assigned') ||
      msg.includes('working on') ||
      msg.includes('my task')
    ) {
      let filter = {};

      if (!isPrivileged) {
        filter = {
          $or: [
            { 'assignedEmployees.employeeId': user._id },
            { teamLead: user._id },
            { teamLeads: user._id }
          ]
        };
      }

      const projects = await Project.find(filter)
        .populate('teamLead', 'name')
        .populate('teamLeads', 'name')
        .sort({ deadline: 1, createdAt: -1 })
        .limit(10);

      if (projects && projects.length > 0) {
        const projList = projects.map((p, idx) => {
          const tlName = (p.teamLead && p.teamLead.name) ? p.teamLead.name : (p.teamLeads && p.teamLeads.length > 0 ? p.teamLeads.map(t => t.name).join(', ') : 'Unassigned');
          const deadlineStr = p.deadline ? new Date(p.deadline).toLocaleDateString('en-IN') : 'No deadline';
          const statusStr = (p.status || 'pending').toUpperCase();
          return `${idx + 1}. **${p.title}**\n   - Status: **${statusStr}** | Priority: **${(p.priority || 'Medium').toUpperCase()}**\n   - Team Lead: **${tlName}** | Deadline: **${deadlineStr}**`;
        }).join('\n\n');

        reply = isPrivileged
          ? `Here are the latest projects in the system:\n\n${projList}\n\nVisit the **Projects > Project List** tab to manage them.`
          : `Here are your currently assigned projects:\n\n${projList}`;
      } else {
        reply = isPrivileged
          ? `No projects have been registered in the system yet.`
          : `You are not currently assigned to any active projects. If you believe this is an error, please check with your Team Leader or HR.`;
      }
    }

    // ── 6. Worklog Status Inquiry ────────────────────────────────────
    else if (
      msg.includes('worklog') ||
      msg.includes('work log') ||
      msg.includes('daily log') ||
      msg.includes('timesheet') ||
      msg.includes('log status')
    ) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayLogs = await Worklog.find({
        employee: user._id,
        date: { $gte: today, $lt: tomorrow }
      }).populate('project', 'title');

      if (todayLogs && todayLogs.length > 0) {
        const logDetails = todayLogs.map(l => {
          const projName = l.project ? l.project.title : 'General Tasks';
          return `• **${projName}**: "${l.description}" [Status: **${l.status}**]`;
        }).join('\n');

        reply = `✅ **You have submitted your worklog for today (${today.toLocaleDateString('en-IN')})!**\n\n${logDetails}`;
      } else {
        const recentLogs = await Worklog.find({ employee: user._id })
          .sort({ date: -1 })
          .limit(3)
          .populate('project', 'title');

        let recentText = '';
        if (recentLogs && recentLogs.length > 0) {
          recentText = `\n\n**Your Most Recent Submissions:**\n` + recentLogs.map(l => {
            const d = new Date(l.date).toLocaleDateString('en-IN');
            return `• ${d} - **${l.project ? l.project.title : 'General'}** (${l.status})`;
          }).join('\n');
        }

        reply = `⚠️ **You have not submitted a worklog for today (${today.toLocaleDateString('en-IN')}) yet.**\n\nPlease submit your daily worklog before end-of-day under the **Worklogs** section.${recentText}`;
      }
    }

    // ── 7. Bugs & Issues Inquiry ─────────────────────────────────────
    else if (
      msg.includes('bug') ||
      msg.includes('issue') ||
      msg.includes('escalat')
    ) {
      const projectsWithIssues = await Project.find({ 'issues.0': { $exists: true } }).select('title issues');
      let allIssues = [];

      for (const p of projectsWithIssues) {
        for (const iss of (p.issues || [])) {
          const statusLower = (iss.status || '').toLowerCase();
          if (statusLower !== 'resolved' && statusLower !== 'closed') {
            allIssues.push({
              projectTitle: p.title,
              title: iss.title,
              type: iss.type || 'Issue',
              priority: iss.priority || 'Medium',
              status: iss.status || 'Open',
              reportedBy: iss.reportedBy || 'Team Member'
            });
          }
        }
      }

      if (allIssues.length > 0) {
        const issueList = allIssues.slice(0, 6).map((iss, idx) => {
          return `${idx + 1}. **${iss.title}** (${iss.type})\n   - Project: **${iss.projectTitle}**\n   - Priority: **${iss.priority.toUpperCase()}** | Status: **${iss.status}**`;
        }).join('\n\n');

        reply = `🔍 **Found ${allIssues.length} active Open/Escalated Issues & Bugs:**\n\n${issueList}\n\nYou can track and resolve them in the **Bugs Tracker** and **Issues Tracker** tabs.`;
      } else {
        reply = `✅ **There are currently no unresolved bugs or escalated issues!** All reported items have been addressed.`;
      }
    }

    // ── 8. Meetings Inquiry ──────────────────────────────────────────
    else if (
      msg.includes('meeting') ||
      msg.includes('call') ||
      msg.includes('conference') ||
      msg.includes('schedule')
    ) {
      const upcomingMeetings = await Meeting.find({
        $or: [
          { scheduledBy: user._id },
          { attendees: user._id }
        ],
        scheduledTime: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
      })
      .sort({ scheduledTime: 1 })
      .limit(5);

      if (upcomingMeetings && upcomingMeetings.length > 0) {
        const meetList = upcomingMeetings.map((m, idx) => {
          const timeStr = new Date(m.scheduledTime).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
          });
          return `${idx + 1}. **${m.title}**\n   - Scheduled: **${timeStr}**\n   - Status: **${m.status}** | Room: **${m.roomName}**`;
        }).join('\n\n');

        reply = `Here are your upcoming **Meetings**:\n\n${meetList}\n\nYou can join or manage sessions under the **Meetings** menu.`;
      } else {
        reply = `You have no upcoming meetings scheduled right now. You can create a new meeting anytime under the **Meetings** section.`;
      }
    }

    // ── 9. Payments & EMI Financials ─────────────────────────────────
    else if (
      msg.includes('payment') ||
      msg.includes('emi') ||
      msg.includes('financial') ||
      msg.includes('budget') ||
      msg.includes('cost')
    ) {
      const clientProjects = await Project.find({ totalCost: { $gt: 0 } }).select('title totalCost initialAmount payments emiPlan');
      if (clientProjects.length > 0) {
        let totalBudget = 0;
        let totalCollected = 0;

        const projSummary = clientProjects.slice(0, 5).map(p => {
          const paid = (p.initialAmount || 0) + (p.payments || []).reduce((sum, item) => sum + (item.amount || 0), 0);
          totalBudget += (p.totalCost || 0);
          totalCollected += paid;
          return `• **${p.title}**: Total ₹${p.totalCost.toLocaleString('en-IN')} (Collected: **₹${paid.toLocaleString('en-IN')}**)`;
        }).join('\n');

        reply = `💰 **Corporate Financial Overview:**\n\n${projSummary}\n\n- **Total Monitored Budget:** ₹${totalBudget.toLocaleString('en-IN')}\n- **Total Collected Revenue:** ₹${totalCollected.toLocaleString('en-IN')}\n\nView the **Financials & Payments** section for full EMI breakdowns.`;
      } else {
        reply = `No financial records or cost structures logged yet.`;
      }
    }

    // ── 10. Weekly Plan Inquiry ──────────────────────────────────────
    else if (
      msg.includes('plan') ||
      msg.includes('roadmap') ||
      msg.includes('deliverable')
    ) {
      const plans = await WeeklyPlan.find({ status: { $ne: 'Draft' } })
        .sort({ weekStartDate: -1 })
        .limit(3)
        .populate('teamLead', 'name');

      if (plans && plans.length > 0) {
        const planList = plans.map(p => {
          const start = new Date(p.weekStartDate).toLocaleDateString('en-IN');
          const end = new Date(p.weekEndDate).toLocaleDateString('en-IN');
          return `• **${p.title}** (${start} to ${end}) - Lead: **${p.teamLead ? p.teamLead.name : 'TL'}** [Status: **${p.status}**]`;
        }).join('\n');

        reply = `Here are the active **Weekly Work Plans**:\n\n${planList}\n\nCheck the **Weekly Plans** menu for comprehensive task allocations and target deliverables.`;
      } else {
        reply = `No published weekly plans found currently.`;
      }
    }

    // ── 11. Inventory / Hardware Inquiry ─────────────────────────────
    else if (
      msg.includes('inventory') ||
      msg.includes('hardware') ||
      msg.includes('component') ||
      msg.includes('stock')
    ) {
      const items = await InventoryItem.find({ status: 'Available' }).sort({ availableQuantity: -1 }).limit(6);
      if (items && items.length > 0) {
        const itemList = items.map(i => `• **${i.name}** (${i.category || 'General'}) - **${i.availableQuantity}** in stock`).join('\n');
        reply = `Here is a snapshot of available **Inventory Stock**:\n\n${itemList}\n\nYou can request components directly from the **Inventory** or **Project Details** screen.`;
      } else {
        reply = `Inventory stock data is currently being updated. Visit the **Inventory** tab to view components or place a purchase request.`;
      }
    }

    // ── 12. Employees / Members Inquiry ──────────────────────────────
    else if (
      msg.includes('employee') ||
      msg.includes('member') ||
      msg.includes('user') ||
      msg.includes('staff') ||
      msg.includes('people')
    ) {
      const activeUsers = await User.find({ status: 'Active' }).select('name role department');
      const empCount = activeUsers.filter(u => u.role === 'Employee').length;
      const tlCount = activeUsers.filter(u => u.role === 'TeamLead').length;
      const hrCount = activeUsers.filter(u => u.role === 'HR').length;
      const adminCount = activeUsers.filter(u => u.role === 'Admin').length;

      reply = `👥 **Team & Personnel Summary:**\n\n• **Employees:** ${empCount}\n• **Team Leaders:** ${tlCount}\n• **HR Department:** ${hrCount}\n• **Administrators:** ${adminCount}\n\nTotal Active Personnel: **${activeUsers.length}** members across departments.`;
    }

    // ── 13. System Statistics / Summary ──────────────────────────────
    else if (
      msg.includes('summary') ||
      msg.includes('stats') ||
      msg.includes('statistics') ||
      msg.includes('overview')
    ) {
      const totalProjects = await Project.countDocuments();
      const activeProjects = await Project.countDocuments({ status: { $in: ['pending', 'in-progress'] } });
      const completedProjects = await Project.countDocuments({ status: 'completed' });
      const overdueProjects = await Project.countDocuments({ status: { $nin: ['completed', 'cancelled'] }, deadline: { $lt: new Date() } });

      reply = `📊 **PMS System Summary:**\n\n• **Total Projects:** ${totalProjects}\n• **Active (In-Progress/Pending):** ${activeProjects}\n• **Completed Projects:** ${completedProjects}\n• **Overdue Projects:** ${overdueProjects}\n\nAsk me anytime for more specific details regarding projects, team members, or tasks!`;
    }

    // ── 14. Greetings & General Assistance ───────────────────────────
    else if (
      msg.includes('hello') ||
      msg.includes('hi') ||
      msg.includes('hey') ||
      msg.includes('help') ||
      msg.includes('who are you')
    ) {
      reply = `Hello **${user.name}**! 👋 I am your **PMS AI Assistant**.\n\nI can help you with:\n• **Overdue Projects & Deadlines** (e.g. *"overdue"*)\n• **HR & Team Contacts** (e.g. *"Who is the HR?"*)\n• **Assigned Projects** (e.g. *"What are my assigned projects?"*)\n• **Worklog Status** (e.g. *"Show my worklog status"*)\n• **Bugs & Issues** (e.g. *"Show open bugs"*)\n• **Meeting Schedules** (e.g. *"What meetings am I invited to?"*)\n• **Weekly Roadmaps & Inventory Stock**\n\nFeel free to ask me any question!`;
    }

    // ── 15. Default Fallback ─────────────────────────────────────────
    else {
      reply = `I understand you're asking about "${message.trim()}".\n\nI can directly look up:\n• **Overdue Projects** (e.g. *"overdue"*)\n• **HR & Team Contacts** (e.g. *"Who is the HR?"*)\n• **Assigned Projects & Deadlines** (e.g. *"What are my assigned projects?"*)\n• **Worklog Submissions** (e.g. *"Show my worklog status"*)\n• **Bugs & Issues Tracker** (e.g. *"Show open bugs"*)\n• **Meeting Schedules** (e.g. *"What meetings am I invited to?"*)\n• **Weekly Roadmaps & Inventory Components**\n\nHow can I help you with any of these?`;
    }

    res.json({
      reply,
      user: {
        id: user._id,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error("Chatbot Controller Error:", error);
    res.status(500).json({ message: 'Error processing AI assistant request' });
  }
};
