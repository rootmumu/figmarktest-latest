const Worklog = require('../models/Worklog');
const Project = require('../models/Project');
const User = require('../models/User');
const Notification = require('../models/Notification');

const sendNotification = async (app, userId, message, type = 'info', link = '', title = '') => {
  try {
    const notif = await Notification.create({
      user: userId,
      message,
      type,
      title: title || '',
      link
    });
    const io = app.get('socketio');
    if (io) {
      io.to(userId.toString()).emit('new-notification', notif);
      io.to(userId.toString()).emit('notification', notif);
    }
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

// Helper to notify all Admin and HR members
const notifyAdminsAndHR = async (app, message, type = 'info', link = '/worklogs/all', title = 'Worklog Submitted') => {
  try {
    const adminHrUsers = await User.find({ role: { $in: ['HR', 'Admin'] } });
    for (const u of adminHrUsers) {
      await sendNotification(app, u._id, message, type, link, title);
    }
  } catch (err) {
    console.error("Worklog notify Admin & HR error:", err);
  }
};

// @desc    Submit a daily worklog (Employee)
// @route   POST /api/worklogs
// @access  Private (Employee)
exports.submitWorklog = async (req, res) => {
  try {
    const { project, description, date } = req.body;

    let worklogDate = new Date();
    if (date) {
      worklogDate = new Date(date);
    }
    worklogDate.setHours(0, 0, 0, 0);

    // If project specified and submitted by Employee, verify assignment
    if (project && req.user && (req.user.role === 'Employee' || (req.user.role || '').toLowerCase() === 'employee')) {
      const projDoc = await Project.findById(project);
      if (projDoc) {
        const userId = req.user._id ? req.user._id.toString() : '';
        const userEmail = (req.user.email || '').toLowerCase().trim();
        const userName = (req.user.name || '').toLowerCase().trim();
        const isAssigned = (projDoc.assignedEmployees || []).some(e => {
          const empId = e.employeeId && e.employeeId._id 
            ? e.employeeId._id.toString() 
            : (e.employeeId ? e.employeeId.toString() : '');
          const empContact = (e.contact || '').toLowerCase().trim();
          const empName = (e.name || '').toLowerCase().trim();
          return (empId && empId === userId) ||
                 (userEmail && empContact && empContact === userEmail) ||
                 (userName && empName && empName === userName);
        }) || (projDoc.assignedMembers || []).some(m => {
          const mEmail = (m.email || '').toLowerCase().trim();
          const mContact = (m.contact || '').toLowerCase().trim();
          const mName = (m.name || '').toLowerCase().trim();
          return (userEmail && (mEmail === userEmail || mContact === userEmail)) ||
                 (userName && mName === userName);
        }) || (projDoc.teamLeads || []).some(tl => {
          const tlId = tl && tl._id ? tl._id.toString() : (tl ? tl.toString() : '');
          return tlId && tlId === userId;
        }) || (projDoc.teamLead && (projDoc.teamLead._id ? projDoc.teamLead._id.toString() : projDoc.teamLead.toString()) === userId);

        if (!isAssigned) {
          return res.status(403).json({ success: false, message: 'You can only submit worklogs for projects you are assigned to.' });
        }
      }
    }

    // Auto confirm worklog if submitted by Team Lead, HR, or Admin
    const isTeamLeadOrHigher = req.user && ['TeamLead', 'HR', 'Admin'].includes(req.user.role);
    const status = isTeamLeadOrHigher ? 'Verified' : 'Pending';

    const worklog = new Worklog({
      employee: req.user._id,
      date: worklogDate,
      project: project || null,
      description,
      status: status,
      verifiedBy: isTeamLeadOrHigher ? req.user._id : null
    });

    await worklog.save();

    // Populate project details before sending back
    const populatedWorklog = await Worklog.findById(worklog._id).populate('project', 'title teamLead');

    const employeeName = req.user.name || 'An employee';
    const projectName = populatedWorklog.project ? populatedWorklog.project.title : '';
    const formattedDate = worklogDate.toLocaleDateString('en-GB');

    const notifMsg = projectName
      ? `${employeeName} submitted a worklog for "${projectName}" (${formattedDate}).`
      : `${employeeName} submitted a worklog for ${formattedDate}.`;

    // 1. Notify Team Lead
    if (populatedWorklog.project && populatedWorklog.project.teamLead) {
      const tlId = populatedWorklog.project.teamLead;
      if (tlId.toString() !== req.user._id.toString()) {
        await sendNotification(req.app, tlId, `${notifMsg} Please verify it.`, 'info', '/worklogs/team', 'Worklog Submitted');
      }
    } else if (req.user.department) {
      const deptTeamLeads = await User.find({ role: 'TeamLead', department: req.user.department });
      for (const tl of deptTeamLeads) {
        if (tl._id.toString() !== req.user._id.toString()) {
          await sendNotification(req.app, tl._id, `${notifMsg} Please verify it.`, 'info', '/worklogs/team', 'Worklog Submitted');
        }
      }
    }

    // 2. Notify Admin and HR (so they know worklog was submitted/completed)
    if (!isTeamLeadOrHigher || req.user.role === 'Employee') {
      const adminHrUsers = await User.find({ 
        role: { $in: ['HR', 'Admin'] },
        _id: { $ne: req.user._id }
      });
      for (const adminHr of adminHrUsers) {
        await sendNotification(req.app, adminHr._id, notifMsg, 'info', '/worklogs/all', 'New Worklog Submitted');
      }
    }

    res.status(201).json({
      success: true,
      message: isTeamLeadOrHigher ? 'Worklog submitted and automatically verified' : 'Worklog submitted successfully',
      worklog: populatedWorklog
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get employee's own worklogs
// @route   GET /api/worklogs/me
// @access  Private (Employee)
exports.getMyWorklogs = async (req, res) => {
  try {
    const worklogs = await Worklog.find({ employee: req.user._id })
      .populate('project', 'title')
      .sort({ date: -1, createdAt: -1 });

    res.status(200).json({ success: true, count: worklogs.length, data: worklogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get team worklogs (TeamLead)
// @route   GET /api/worklogs/team
// @access  Private (TeamLead)
exports.getTeamWorklogs = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const User = require('../models/User');
    const verifierRole = req.user.role;
    let query = { ...dateFilter };

    if (verifierRole === 'TeamLead') {
      const userDept = (req.user.department || '').trim();

      // 1. Projects where this user is Team Lead
      const myProjects = await Project.find({
        $or: [
          { teamLead: req.user._id },
          { teamLeads: req.user._id }
        ]
      }).select('_id assignedEmployees.employeeId assignedEmployees.contact assignedEmployees.name');
      
      const projectIds = myProjects.map(p => p._id);

      const managedEmployeeIds = [];
      const managedEmails = [];
      const managedNames = [];

      myProjects.forEach(proj => {
        (proj.assignedEmployees || []).forEach(emp => {
          if (emp.employeeId) {
            const idStr = emp.employeeId.toString();
            if (!managedEmployeeIds.includes(idStr)) managedEmployeeIds.push(idStr);
          }
          if (emp.contact && emp.contact.trim()) {
            managedEmails.push(emp.contact.trim().toLowerCase());
          }
          if (emp.name && emp.name.trim()) {
            managedNames.push(emp.name.trim().toLowerCase());
          }
        });
      });

      const deptCondition = [];
      if (userDept) {
        deptCondition.push({ department: { $regex: new RegExp(`^${userDept}$`, 'i') } });
      }
      if (userDept.toLowerCase().includes('software')) {
        deptCondition.push({ department: { $regex: /^(software|ai|web|design)/i } });
      } else if (userDept.toLowerCase().includes('electronics')) {
        deptCondition.push({ department: { $regex: /^(electronics|embedded|solar|hardware|iot)/i } });
      }

      const empFilter = {
        role: 'Employee',
        $or: [
          { _id: { $in: managedEmployeeIds } },
          { email: { $in: managedEmails } },
          { name: { $in: managedNames } },
          ...deptCondition
        ]
      };

      const employees = await User.find(empFilter).select('_id');
      const employeeIds = employees.map(e => e._id);

      query = {
        ...query,
        employee: { $in: employeeIds }
      };
    } else if (verifierRole === 'HR') {
      // HR sees worklogs of TeamLeads
      const teamLeads = await User.find({ role: 'TeamLead' }).select('_id');
      const teamLeadIds = teamLeads.map(u => u._id);
      query = { ...query, employee: { $in: teamLeadIds } };
    } else if (verifierRole === 'Admin') {
      // Admin sees worklogs of HRs
      const hrs = await User.find({ role: 'HR' }).select('_id');
      const hrIds = hrs.map(u => u._id);
      query = { ...query, employee: { $in: hrIds } };
    } else {
      return res.status(403).json({ success: false, message: 'Not authorized to verify worklogs.' });
    }

    const worklogs = await Worklog.find(query)
      .populate('employee', 'name email designation role')
      .populate('project', 'title')
      .sort({ date: -1, createdAt: -1 });

    // Auto verify Team Lead worklogs if any were pending
    for (const log of worklogs) {
      if (log.employee && ['TeamLead', 'HR', 'Admin'].includes(log.employee.role) && log.status === 'Pending') {
        log.status = 'Verified';
        log.verifiedBy = log.employee._id;
        await Worklog.updateOne({ _id: log._id }, { status: 'Verified', verifiedBy: log.employee._id });
      }
    }

    res.status(200).json({ success: true, count: worklogs.length, data: worklogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get all worklogs (HR/Admin)
// @route   GET /api/worklogs/all
// @access  Private (Admin, HR)
exports.getAllWorklogs = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = {};

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const worklogs = await Worklog.find(query)
      .populate('employee', 'name email department designation role')
      .populate('project', 'title')
      .populate('verifiedBy', 'name')
      .sort({ date: -1, createdAt: -1 });

    for (const log of worklogs) {
      if (log.employee && ['TeamLead', 'HR', 'Admin'].includes(log.employee.role) && log.status === 'Pending') {
        log.status = 'Verified';
        log.verifiedBy = log.employee._id;
        await Worklog.updateOne({ _id: log._id }, { status: 'Verified', verifiedBy: log.employee._id });
      }
    }

    res.status(200).json({ success: true, count: worklogs.length, data: worklogs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Edit a worklog (TeamLead)
// @route   PUT /api/worklogs/:id
// @access  Private (TeamLead)
exports.updateWorklog = async (req, res) => {
  try {
    if (req.user && req.user.role === 'HR') {
      return res.status(403).json({ success: false, message: 'HR is not authorized to edit worklogs' });
    }
    const { description } = req.body;
    const worklog = await Worklog.findById(req.params.id);

    if (!worklog) {
      return res.status(404).json({ success: false, message: 'Worklog not found' });
    }

    worklog.description = description;
    await worklog.save();

    res.status(200).json({ success: true, message: 'Worklog updated', data: worklog });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Verify a worklog (Approve/Reject)
// @route   PUT /api/worklogs/:id/verify
// @access  Private (TeamLead)
exports.verifyWorklog = async (req, res) => {
  try {
    const { status, teamLeadRemarks } = req.body;

    if (!['Verified', 'Rejected', 'Pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const worklog = await Worklog.findById(req.params.id);

    if (!worklog) {
      return res.status(404).json({ success: false, message: 'Worklog not found' });
    }

    const User = require('../models/User');
    const employeeUser = await User.findById(worklog.employee);
    if (!employeeUser) {
      return res.status(404).json({ success: false, message: 'Employee user not found for this worklog.' });
    }

    const employeeRole = employeeUser.role;
    const verifierRole = req.user.role;

    if (employeeRole === 'Employee' && verifierRole !== 'TeamLead') {
      return res.status(403).json({ success: false, message: 'Worklogs of Employees can only be verified by a Team Lead.' });
    }
    if (employeeRole === 'TeamLead' && verifierRole !== 'HR') {
      return res.status(403).json({ success: false, message: 'Worklogs of Team Leads can only be verified by HR.' });
    }
    if (employeeRole === 'HR' && verifierRole !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Worklogs of HR can only be verified by Admin.' });
    }

    worklog.status = status;
    worklog.teamLeadRemarks = teamLeadRemarks || '';
    worklog.verifiedBy = req.user._id;

    await worklog.save();

    if (status === 'Verified') {
      await sendNotification(req.app, worklog.employee, 'Your worklog has been verified by your Team Lead.', 'success', '/worklogs/me');
    } else if (status === 'Rejected') {
      await sendNotification(req.app, worklog.employee, 'Your worklog has been rejected. Please review and resubmit.', 'danger', '/worklogs/me');
    }

    res.status(200).json({ success: true, message: `Worklog ${status.toLowerCase()}`, data: worklog });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Delete a worklog (TeamLead/Admin/HR)
// @route   DELETE /api/worklogs/:id
// @access  Private (TeamLead, Admin, HR)
exports.deleteWorklog = async (req, res) => {
  try {
    if (req.user && req.user.role === 'HR') {
      return res.status(403).json({ success: false, message: 'HR is not authorized to delete worklogs' });
    }
    const worklog = await Worklog.findById(req.params.id)
      .populate('employee', 'name email role')
      .populate('project', 'title');

    if (!worklog) {
      return res.status(404).json({ success: false, message: 'Worklog not found' });
    }

    // Capture worklog details before deletion
    const employeeName = worklog.employee ? worklog.employee.name : 'Unknown Employee';
    const worklogDateFormatted = new Date(worklog.date).toLocaleDateString('en-GB');
    const projectName = worklog.project ? worklog.project.title : 'Other';
    const worklogDescription = worklog.description || 'No description provided';
    const teamLeadName = req.user ? req.user.name : 'Team Lead';
    const deletionTimestamp = new Date().toLocaleString();

    // Perform database deletion
    await Worklog.findByIdAndDelete(req.params.id);

    // After successful deletion, notify Admin and HR users
    const recipients = await User.find({ role: { $in: ['Admin', 'HR'] } }).select('_id role');

    const notifTitle = 'Worklog Deleted by Team Lead';
    const notifMessage = `Team Lead ${teamLeadName} deleted a worklog submitted by ${employeeName}.\n\nWorklog Details:\n- Employee: ${employeeName}\n- Date: ${worklogDateFormatted}\n- Project: ${projectName}\n- Description: ${worklogDescription}\n- Deleted By: ${teamLeadName}\n- Deleted At: ${deletionTimestamp}`;

    const io = req.app.get('socketio');

    for (const recipient of recipients) {
      const notif = await Notification.create({
        user: recipient._id,
        title: notifTitle,
        message: notifMessage,
        type: 'danger',
        action: 'WORKLOG_DELETED',
        sender: teamLeadName,
        link: '/worklogs/all'
      });

      if (io) {
        io.to(recipient._id.toString()).emit('notification', notif);
        io.to(recipient._id.toString()).emit('new-notification', notif);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Worklog deleted successfully and notification sent to Admin and HR.'
    });
  } catch (error) {
    console.error('Error deleting worklog:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Export worklogs as CSV, Excel, or JSON (HR/Admin)
// @route   GET /api/worklogs/export
// @access  Private (Admin, HR)
exports.exportWorklogs = async (req, res) => {
  try {
    const { startDate, endDate, employeeId, status, department } = req.query;
    let query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    if (employeeId && employeeId !== 'all') {
      query.employee = employeeId;
    }

    if (status && status !== 'all') {
      const s = status.toLowerCase();
      if (s === 'submitted' || s === 'pending') {
        query.status = 'Pending';
      } else if (s === 'verified') {
        query.status = 'Verified';
      } else if (s === 'rejected') {
        query.status = 'Rejected';
      } else {
        query.status = new RegExp(`^${status}$`, 'i');
      }
    }

    let worklogs = await Worklog.find(query)
      .populate('employee', 'name email department designation role employeeId')
      .populate('project', 'title domain type clientName collegeName')
      .populate('verifiedBy', 'name email')
      .sort({ date: -1, createdAt: -1 });

    if (department && department !== 'all') {
      worklogs = worklogs.filter(w => w.employee && w.employee.department === department);
    }

    const format = (req.query.format || 'json').toLowerCase();

    if (format === 'excel' || format === 'xls') {
      const tableRows = worklogs.map((log, i) => {
        const emp = log.employee || {};
        const proj = log.project || {};
        const ver = log.verifiedBy || {};
        const dateObj = log.date ? new Date(log.date) : null;
        const dateStr = dateObj ? dateObj.toISOString().split('T')[0] : 'N/A';
        const subAt = log.createdAt ? new Date(log.createdAt).toLocaleString('en-GB') : '';
        const rowBg = i % 2 === 0 ? '#ffffff' : '#f8fafc';

        let statusBg = '#fef3c7', statusColor = '#92400e';
        if (log.status === 'Verified') { statusBg = '#dcfce7'; statusColor = '#166534'; }
        else if (log.status === 'Rejected') { statusBg = '#fee2e2'; statusColor = '#991b1b'; }

        const safeDesc = (log.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeRemarks = (log.teamLeadRemarks || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return `
        <tr style="background-color: ${rowBg};">
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 11pt; text-align: center; mso-number-format:'\\@';">${dateStr}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 11pt; font-weight: bold; color: #1e293b;">${emp.name || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; color: #64748b;">${emp.email || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; text-align: center;">${emp.department || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt;">${emp.designation || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; text-align: center;">${emp.role || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; font-weight: 600; color: #0f766e;">${proj.title || 'General / Internal'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; white-space: pre-wrap;">${safeDesc}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; text-align: center; background-color: ${statusBg}; color: ${statusColor}; font-weight: bold;">${log.status || 'Pending'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt;">${ver.name || 'N/A'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; color: #dc2626;">${safeRemarks}</td>
          <td style="border: 1px solid #cbd5e1; padding: 8px 10px; font-family: Segoe UI, Arial; font-size: 10pt; color: #64748b; text-align: center;">${subAt}</td>
        </tr>`;
      }).join('');

      const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Worklogs Export</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          th { font-family: Segoe UI, Arial; font-size: 11pt; font-weight: bold; background-color: #1e3a8a; color: #ffffff; padding: 10px 12px; border: 1px solid #172554; text-align: left; }
        </style>
      </head>
      <body>
        <table style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="text-align: center;">Date</th>
              <th>Employee Name</th>
              <th>Employee Email</th>
              <th style="text-align: center;">Department</th>
              <th>Designation</th>
              <th style="text-align: center;">Role</th>
              <th>Project Title</th>
              <th style="min-width: 250px;">Worklog Description</th>
              <th style="text-align: center;">Status</th>
              <th>Verified By</th>
              <th>Remarks</th>
              <th style="text-align: center;">Submitted At</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
      </html>`;

      const filename = `worklogs_${startDate || 'all'}_to_${endDate || 'all'}.xls`;
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(excelHtml);
    }

    if (format === 'csv') {
      const headers = [
        'Date',
        'Employee Name',
        'Employee Email',
        'Department',
        'Designation',
        'Role',
        'Project Title',
        'Project Domain',
        'Project Type',
        'Client/College',
        'Worklog Description',
        'Status',
        'Verified By',
        'Team Lead Remarks',
        'Submitted At'
      ];

      const escapeCSV = (str) => {
        if (str === null || str === undefined) return '""';
        const stringified = String(str).replace(/"/g, '""');
        return `"${stringified}"`;
      };

      const rows = worklogs.map(log => {
        const emp = log.employee || {};
        const proj = log.project || {};
        const verifier = log.verifiedBy || {};
        const dateObj = log.date ? new Date(log.date) : null;
        const dateStr = dateObj ? dateObj.toISOString().split('T')[0] : '';
        const submittedAt = log.createdAt ? new Date(log.createdAt).toLocaleString('en-GB') : '';

        return [
          escapeCSV(dateStr),
          escapeCSV(emp.name || 'N/A'),
          escapeCSV(emp.email || 'N/A'),
          escapeCSV(emp.department || 'N/A'),
          escapeCSV(emp.designation || 'N/A'),
          escapeCSV(emp.role || 'N/A'),
          escapeCSV(proj.title || 'General / Internal'),
          escapeCSV(proj.domain || 'N/A'),
          escapeCSV(proj.type || 'N/A'),
          escapeCSV(proj.clientName || proj.collegeName || 'N/A'),
          escapeCSV(log.description || ''),
          escapeCSV(log.status || 'Pending'),
          escapeCSV(verifier.name || 'N/A'),
          escapeCSV(log.teamLeadRemarks || ''),
          escapeCSV(submittedAt)
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

      const filename = `worklogs_${startDate || 'all'}_to_${endDate || 'all'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    }

    res.status(200).json({
      success: true,
      count: worklogs.length,
      data: worklogs
    });
  } catch (error) {
    console.error('Export worklogs error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};



