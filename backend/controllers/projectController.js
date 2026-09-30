const Project = require('../models/Project');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { sendInitialPaymentReceipt, sendEmiPaymentReceipt } = require('../utils/mailer');
const { compressFile } = require('../utils/compressHelper');

const parseSafeDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    let s = val.trim();
    if (!s) return null;
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(s)) {
      const parts = s.split(/[-/]/);
      s = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

// Helper to check if an employee is assigned to a project
const isEmployeeAssigned = (project, user) => {
  if (!project || !user) return false;
  const userId = user._id ? user._id.toString() : '';
  const userEmail = (user.email || '').toLowerCase().trim();
  const userName = (user.name || '').toLowerCase().trim();

  return (project.assignedEmployees || []).some(e => {
    const empId = e.employeeId && e.employeeId._id 
      ? e.employeeId._id.toString() 
      : (e.employeeId ? e.employeeId.toString() : '');
    const empContact = (e.contact || '').toLowerCase().trim();
    const empName = (e.name || '').toLowerCase().trim();

    return (empId && empId === userId) ||
           (userEmail && empContact && empContact === userEmail) ||
           (userName && empName && empName === userName);
  });
};

// Helper to check if a team lead is assigned to a project
const isTeamLeadAssigned = (project, user) => {
  if (!project || !user) return false;
  const userId = user._id ? user._id.toString() : '';
  const userEmail = (user.email || '').toLowerCase().trim();
  const userName = (user.name || '').toLowerCase().trim();

  const tlId = project.teamLead && project.teamLead._id
    ? project.teamLead._id.toString()
    : (project.teamLead ? project.teamLead.toString() : '');
  const tlName = (project.teamLead && project.teamLead.name ? project.teamLead.name : '').toLowerCase().trim();
  const tlEmail = (project.teamLead && project.teamLead.email ? project.teamLead.email : '').toLowerCase().trim();

  if ((tlId && tlId === userId) || (userEmail && tlEmail && tlEmail === userEmail) || (userName && tlName && tlName === userName)) {
    return true;
  }

  const inTeamLeads = (project.teamLeads || []).some(tl => {
    const id = tl && tl._id ? tl._id.toString() : (tl ? tl.toString() : '');
    const name = (tl && tl.name ? tl.name : '').toLowerCase().trim();
    const email = (tl && tl.email ? tl.email : '').toLowerCase().trim();
    return (id && id === userId) || (userEmail && email && email === userEmail) || (userName && name && name === userName);
  });

  if (inTeamLeads) return true;

  return isEmployeeAssigned(project, user);
};

// Helper to log activities
const logActivity = async (projectId, projectName, userId, userName, action, roleScope = ['Admin', 'HR', 'TeamLead']) => {
  try {
    await ActivityLog.create({
      projectId,
      projectName,
      user: userId,
      userName,
      action,
      roleScope
    });
  } catch (err) {
    console.error("Activity log error:", err);
  }
};

// Helper to send real-time notification
const sendNotification = async (app, userId, message, type = 'info', link = '') => {
  try {
    const notif = await Notification.create({
      user: userId,
      message,
      type,
      sender: 'System',
      link
    });

    const io = app.get('socketio');
    if (io) {
      const socketPayload = {
        _id: notif._id,
        user: userId,
        message,
        type,
        sender: 'System',
        link,
        createdAt: notif.createdAt,
        read: false
      };
      io.to(userId.toString()).emit('notification', socketPayload);
    }
  } catch (err) {
    console.error("Send notification error:", err);
  }
};

// Helper to notify HR in bulk
const notifyHR = async (app, message, type = 'info', link = '') => {
  try {
    const hrUsers = await User.find({ role: { $in: ['HR', 'Admin'] } });
    for (const hr of hrUsers) {
      await sendNotification(app, hr._id, message, type, link);
    }
  } catch (err) {
    console.error("Notify HR error:", err);
  }
};

exports.createProject = async (req, res) => {
  try {
    if (req.body.status) {
      req.body.status = req.body.status.toLowerCase();
    }
    // Synchronize teamLead and teamLeads array on creation
    if (req.body.teamLeads) {
      req.body.teamLead = req.body.teamLeads.length > 0 ? req.body.teamLeads[0] : null;
    } else if (req.body.teamLead) {
      req.body.teamLeads = [req.body.teamLead];
    }

    // Validation: Check for inactive members/team leads
    if (req.body.assignedEmployees && req.body.assignedEmployees.length > 0) {
      const empIds = req.body.assignedEmployees.map(e => e.employeeId).filter(Boolean);
      const inactiveEmployees = await User.find({ _id: { $in: empIds }, status: 'Inactive' });
      if (inactiveEmployees.length > 0) {
        const names = inactiveEmployees.map(u => u.name).join(', ');
        return res.status(400).json({ message: `Cannot assign project to inactive member(s): ${names}` });
      }
    }

    if (req.body.teamLeads && req.body.teamLeads.length > 0) {
      const tlIds = req.body.teamLeads.filter(Boolean);
      const inactiveTLs = await User.find({ _id: { $in: tlIds }, status: 'Inactive' });
      if (inactiveTLs.length > 0) {
        const names = inactiveTLs.map(u => u.name).join(', ');
        return res.status(400).json({ message: `Cannot assign project to inactive Team Lead(s): ${names}` });
      }
    }

    const project = await Project.create(req.body);

    // Notify Team Leads
    if (project.teamLeads && project.teamLeads.length > 0) {
      for (const tlId of project.teamLeads) {
        await sendNotification(
          req.app,
          tlId,
          `You have been assigned as a Team Leader for project: ${project.title}`,
          'info',
          `/project-details/${project._id}`
        );
      }
    }

    // Notify Assigned Employees
    if (project.assignedEmployees && project.assignedEmployees.length > 0) {
      for (const emp of project.assignedEmployees) {
        const empId = emp.employeeId || emp._id;
        if (empId) {
          await sendNotification(
            req.app,
            empId,
            `You have been assigned to project: ${project.title}`,
            'info',
            `/project-details/${project._id}`
          );
        }
      }
    }

    // Notify HR
    await notifyHR(req.app, `HR ALERT: Project "${project.title}" has been created.`, 'info', `/project-details/${project._id}`);

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System Console", `Project created: "${project.title}"`);

    res.status(201).json(project);
  } catch (error) {
    console.error("Create Project Error:", error);
    res.status(500).json({ message: 'Server error while creating project' });
  }
};

exports.getProjects = async (req, res) => {
  try {
    let filter = {};

    // Role-based filtering: TeamLeads only see their team projects, Employees only see assigned projects
    if (req.user && (req.user.role === 'TeamLead' || (req.user.role || '').toLowerCase() === 'teamlead')) {
      const userEmail = (req.user.email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userName = (req.user.name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const orConditions = [
        { teamLead: req.user._id },
        { teamLeads: req.user._id },
        { 'assignedEmployees.employeeId': req.user._id }
      ];
      if (userEmail) {
        orConditions.push({ 'assignedEmployees.contact': { $regex: new RegExp(`^${userEmail}$`, 'i') } });
      }
      if (userName) {
        orConditions.push({ 'assignedEmployees.name': { $regex: new RegExp(`^${userName}$`, 'i') } });
      }
      filter = { $or: orConditions };
    } else if (req.user && (req.user.role === 'Employee' || (req.user.role || '').toLowerCase() === 'employee')) {
      const userEmail = (req.user.email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userName = (req.user.name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      const orConditions = [
        { 'assignedEmployees.employeeId': req.user._id }
      ];
      if (userEmail) {
        orConditions.push({ 'assignedEmployees.contact': { $regex: new RegExp(`^${userEmail}$`, 'i') } });
        orConditions.push({ 'assignedMembers.email': { $regex: new RegExp(`^${userEmail}$`, 'i') } });
        orConditions.push({ 'assignedMembers.contact': { $regex: new RegExp(`^${userEmail}$`, 'i') } });
      }
      if (userName) {
        orConditions.push({ 'assignedEmployees.name': { $regex: new RegExp(`^${userName}$`, 'i') } });
        orConditions.push({ 'assignedMembers.name': { $regex: new RegExp(`^${userName}$`, 'i') } });
      }

      filter = { $or: orConditions };
    }

    const projects = await Project.find(filter)
      .populate('teamLead', 'name email')
      .populate('teamLeads', 'name email')
      .populate('assignedEmployees.employeeId', 'name email')
      .sort({ createdAt: -1 });
    res.json(projects);
  } catch (error) {
    console.error("Get Projects Error:", error);
    res.status(500).json({ message: 'Server error while fetching projects' });
  }
};

exports.getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('teamLead', 'name email')
      .populate('teamLeads', 'name email')
      .populate('assignedEmployees.employeeId', 'name email');
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Role-based authorization: Employees and TeamLeads can only view projects they are assigned to
    if (req.user && (req.user.role === 'Employee' || (req.user.role || '').toLowerCase() === 'employee')) {
      if (!isEmployeeAssigned(project, req.user)) {
        return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
      }
    } else if (req.user && (req.user.role === 'TeamLead' || (req.user.role || '').toLowerCase() === 'teamlead')) {
      if (!isTeamLeadAssigned(project, req.user)) {
        return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
      }
    }

    const projectObj = project.toObject();

    // Fetch ComponentRequests for this project and merge into hardwareRequests
    const ComponentRequest = require('../models/ComponentRequest');
    const compRequests = await ComponentRequest.find({ projectId: project._id })
      .populate('employeeId', 'name email')
      .populate('items.itemId', 'name category');

    const hardwareList = [...(projectObj.hardwareRequests || [])];

    for (const cr of compRequests) {
      const empName = cr.employeeId ? cr.employeeId.name : 'Employee';
      const mappedStatus = (cr.status === 'Approved by TL' || cr.status === 'Issued') ? 'Approved' :
        (cr.status === 'Rejected by TL' ? 'Rejected' : 'Pending');

      for (const item of (cr.items || [])) {
        const itemName = item.itemId ? item.itemId.name : (item.name || 'Component');
        const alreadyExists = hardwareList.some(h => (h._id && h._id.toString() === cr._id.toString()));
        if (!alreadyExists) {
          hardwareList.push({
            _id: cr._id,
            name: itemName,
            quantity: item.quantity,
            reason: cr.tlComments || 'Inventory Request',
            requestedBy: empName,
            status: mappedStatus,
            createdAt: cr.createdAt || cr.updatedAt || new Date()
          });
        }
      }
    }

    // Sort by createdAt descending
    hardwareList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    projectObj.hardwareRequests = hardwareList;

    res.json(projectObj);
  } catch (error) {
    console.error("Get Project Error:", error);
    res.status(500).json({ message: 'Server error while fetching project' });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin' || req.user.role === 'Accounts');
    const isTL = req.user && req.user.role === 'TeamLead';
    const isEmp = req.user && req.user.role === 'Employee';

    if (!isHrOrAdmin && !isTL && !isEmp) {
      return res.status(403).json({ message: 'Unauthorized: You are not authorized to update this project' });
    }

    // Employees can only update projects they are assigned to
    if (isEmp && !isEmployeeAssigned(project, req.user)) {
      return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
    }

    // Allow metadata/progress updates for assigned employees & TLs, stripping financial metadata if edited by non-HR/Admin/Accounts
    if (!isHrOrAdmin) {
      const restrictedKeys = ['totalCost', 'emiPlan', 'initialAmount', 'payments', 'emiSchedule'];
      restrictedKeys.forEach(key => {
        delete req.body[key];
      });
    }

    // Helper to extract clean ObjectId string
    const mongoose = require('mongoose');
    const getEmpIdStr = (e) => {
      if (!e) return '';
      if (e.employeeId) {
        return (e.employeeId._id ? e.employeeId._id.toString() : e.employeeId.toString()).trim();
      }
      return (e._id ? e._id.toString() : '').trim();
    };
    const getTLIdStr = (t) => {
      if (!t) return '';
      if (t._id) return t._id.toString().trim();
      return t.toString().trim();
    };

    // Synchronize teamLead and teamLeads array
    if (req.body.teamLeads !== undefined) {
      const validTLs = (Array.isArray(req.body.teamLeads) ? req.body.teamLeads : [req.body.teamLeads])
        .map(getTLIdStr)
        .filter(id => id && mongoose.Types.ObjectId.isValid(id));
      req.body.teamLeads = validTLs;
      req.body.teamLead = validTLs.length > 0 ? validTLs[0] : null;
    } else if (req.body.teamLead !== undefined) {
      const tlId = getTLIdStr(req.body.teamLead);
      if (tlId && mongoose.Types.ObjectId.isValid(tlId)) {
        req.body.teamLead = tlId;
        req.body.teamLeads = [tlId];
      } else {
        req.body.teamLead = null;
        req.body.teamLeads = [];
      }
    }

    let changes = [];

    if (req.body.status) {
      req.body.status = req.body.status.toLowerCase().trim();
    }
    if (req.body.priority) {
      req.body.priority = req.body.priority.toLowerCase().trim();
    }
    if (req.body.startDate !== undefined) {
      if (req.body.startDate) {
        const parsedStart = parseSafeDate(req.body.startDate);
        if (parsedStart) req.body.startDate = parsedStart;
        else req.body.startDate = null;
      } else {
        req.body.startDate = null;
      }
    }
    if (req.body.deadline !== undefined) {
      if (req.body.deadline) {
        const parsedDeadline = parseSafeDate(req.body.deadline);
        if (parsedDeadline) req.body.deadline = parsedDeadline;
        else req.body.deadline = null;
      } else {
        req.body.deadline = null;
      }
    }

    // Track numerical Progress (0-100%)
    if (req.body.progress !== undefined && req.body.progress !== null) {
      const oldProgress = project.progress || 0;
      const newProgress = Math.max(0, Math.min(100, parseInt(req.body.progress) || 0));
      project.progress = newProgress;
      req.body.progress = newProgress;
      if (oldProgress !== newProgress) {
        changes.push(`Progress updated from ${oldProgress}% to ${newProgress}%`);
      }
      if (newProgress === 100) {
        req.body.status = 'completed';
      } else if (newProgress > 0 && newProgress < 100) {
        if (!req.body.status || req.body.status.toLowerCase() === 'completed' || req.body.status.toLowerCase() === 'pending') {
          req.body.status = 'in-progress';
        }
      }
      if (req.body.progressNote && req.body.progressNote.trim()) {
        project.timeline.push({
          message: `Progress Note (${newProgress}%): ${req.body.progressNote.trim()}`,
          author: req.user ? req.user.name : "Team Lead",
          date: Date.now()
        });
        delete req.body.progressNote;
      }
    } else if (req.body.status && req.body.status.toLowerCase() === 'completed' && (project.progress || 0) < 100) {
      project.progress = 100;
      changes.push(`Progress updated to 100%`);
    }

    if (req.body.status && project.status !== req.body.status) {
      changes.push(`Status changed from '${project.status}' to '${req.body.status}'`);
    }
    if (req.body.priority && project.priority !== req.body.priority) {
      changes.push(`Priority changed from '${project.priority}' to '${req.body.priority}'`);
    }
    if (req.body.deadline) {
      const oldDate = project.deadline ? new Date(project.deadline).toLocaleDateString() : 'N/A';
      const newDate = new Date(req.body.deadline).toLocaleDateString();
      if (oldDate !== newDate) {
        changes.push(`Deadline shifted from ${oldDate} to ${newDate}`);
      }
    }

    // Completed Project Protection
    if (project.status && project.status.toLowerCase() === 'completed' && !isHrOrAdmin) {
      if (req.body.assignedEmployees) {
        const existingEmployees = project.assignedEmployees || [];
        const incomingEmployees = req.body.assignedEmployees || [];

        const existingIds = existingEmployees.map(getEmpIdStr).filter(Boolean);
        const incomingIds = incomingEmployees.map(getEmpIdStr).filter(Boolean);

        const added = incomingEmployees.filter(e => {
          const id = getEmpIdStr(e);
          return id && !existingIds.includes(id);
        });
        const removed = existingEmployees.filter(e => {
          const id = getEmpIdStr(e);
          return id && !incomingIds.includes(id);
        });

        for (const emp of added) {
          const empId = getEmpIdStr(emp);
          // ── DUPLICATE GUARD: skip if a pending 'assign' request already exists for this employee
          const duplicateAssign = project.employeeApprovalRequests.some(
            r => getEmpIdStr(r) === empId &&
                 r.action === 'assign' && r.status === 'pending'
          );
          if (duplicateAssign) continue;

          project.employeeApprovalRequests.push({
            employeeId: emp.employeeId || emp._id,
            name: emp.name,
            role: emp.role,
            contact: emp.contact,
            phone: emp.phone,
            action: 'assign',
            status: 'pending',
            requestedBy: req.user.name
          });

          await notifyHR(
            req.app,
            `HR APPROVAL REQUIRED: TL ${req.user.name} requested to assign ${emp.name} to completed project "${project.title}".`,
            'warning',
            `/project-details/${project._id}`
          );
        }

        for (const emp of removed) {
          const empId = getEmpIdStr(emp);
          // ── DUPLICATE GUARD: skip if a pending 'remove' request already exists for this employee
          const duplicateRemove = project.employeeApprovalRequests.some(
            r => getEmpIdStr(r) === empId &&
                 r.action === 'remove' && r.status === 'pending'
          );
          if (duplicateRemove) continue;

          project.employeeApprovalRequests.push({
            employeeId: emp.employeeId || emp._id,
            name: emp.name,
            role: emp.role,
            contact: emp.contact,
            phone: emp.phone,
            action: 'remove',
            status: 'pending',
            requestedBy: req.user.name
          });

          await notifyHR(
            req.app,
            `HR APPROVAL REQUIRED: TL ${req.user.name} requested to remove ${emp.name} from completed project "${project.title}".`,
            'warning',
            `/project-details/${project._id}`
          );
        }

        // Lock assigned employees list for direct edits
        req.body.assignedEmployees = project.assignedEmployees;
      }
    }

    // Check employee changes on active project
    let newEmployeeIds = [];
    let removedEmployeeIds = [];
    if (req.body.assignedEmployees && (!project.status || project.status.toLowerCase() !== 'completed' || isHrOrAdmin)) {
      const existingIds = (project.assignedEmployees || []).map(getEmpIdStr).filter(Boolean);
      const incomingIds = (req.body.assignedEmployees || []).map(getEmpIdStr).filter(Boolean);

      newEmployeeIds = incomingIds.filter(id => mongoose.Types.ObjectId.isValid(id) && !existingIds.includes(id));
      removedEmployeeIds = existingIds.filter(id => mongoose.Types.ObjectId.isValid(id) && !incomingIds.includes(id));
    }

    // Check Team Lead assignment changes
    let newTLIds = [];
    let removedTLIds = [];
    let existingTLs = [];
    if (req.body.teamLeads) {
      existingTLs = (project.teamLeads || []).map(getTLIdStr).filter(id => id && mongoose.Types.ObjectId.isValid(id));
      const ptId = getTLIdStr(project.teamLead);
      if (ptId && mongoose.Types.ObjectId.isValid(ptId) && !existingTLs.includes(ptId)) {
        existingTLs.push(ptId);
      }
      const incomingTLs = (req.body.teamLeads || []).map(getTLIdStr).filter(id => id && mongoose.Types.ObjectId.isValid(id));
      newTLIds = incomingTLs.filter(t => !existingTLs.includes(t));
      removedTLIds = existingTLs.filter(t => !incomingTLs.includes(t));
    }

    // Validation: Check if new employees being assigned are inactive
    if (newEmployeeIds.length > 0) {
      const inactiveEmployees = await User.find({ _id: { $in: newEmployeeIds }, status: 'Inactive' });
      if (inactiveEmployees.length > 0) {
        const names = inactiveEmployees.map(u => u.name).join(', ');
        return res.status(400).json({ message: `Cannot assign project to inactive member(s): ${names}` });
      }
    }

    // Validation: Check if new Team Leads being assigned are inactive
    if (newTLIds.length > 0) {
      const inactiveTLs = await User.find({ _id: { $in: newTLIds }, status: 'Inactive' });
      if (inactiveTLs.length > 0) {
        const names = inactiveTLs.map(u => u.name).join(', ');
        return res.status(400).json({ message: `Cannot assign project to inactive Team Lead(s): ${names}` });
      }
    }

    // Backend validation for Financials & EMI setup
    if (req.body.totalCost !== undefined && req.body.totalCost !== '' && req.body.totalCost !== null) {
      const tc = Number(req.body.totalCost);
      if (isNaN(tc) || tc < 0) return res.status(400).json({ message: 'Total cost must be a valid number greater than or equal to 0' });
      req.body.totalCost = tc;
    } else if (req.body.totalCost === '') {
      req.body.totalCost = null;
    }

    if (req.body.initialAmount !== undefined && req.body.initialAmount !== '' && req.body.initialAmount !== null) {
      const ia = Number(req.body.initialAmount);
      const tc = req.body.totalCost !== undefined && req.body.totalCost !== null ? Number(req.body.totalCost) : (project.totalCost || 0);
      if (isNaN(ia) || ia < 0) return res.status(400).json({ message: 'Initial amount cannot be negative' });
      if (tc > 0 && ia > tc) return res.status(400).json({ message: 'Initial amount cannot exceed total project cost' });
      req.body.initialAmount = ia;
    } else if (req.body.initialAmount === '') {
      req.body.initialAmount = 0;
    }

    if (req.body.emiPlan !== undefined && req.body.emiPlan !== '' && req.body.emiPlan !== null) {
      const ep = Number(req.body.emiPlan);
      if (isNaN(ep) || !Number.isInteger(ep) || ep < 1) return res.status(400).json({ message: 'EMI plan must be a whole number greater than 0' });
      req.body.emiPlan = ep;
    } else if (req.body.emiPlan === '') {
      req.body.emiPlan = 1;
    }

    if (req.body.initialPaymentDate !== undefined && req.body.initialPaymentDate !== '' && req.body.initialPaymentDate !== null) {
      const pd = parseSafeDate(req.body.initialPaymentDate);
      if (pd) req.body.initialPaymentDate = pd;
      else return res.status(400).json({ message: 'Initial Payment Date is invalid' });
    } else if (req.body.initialPaymentDate === '') {
      req.body.initialPaymentDate = null;
    }

    // ── DEDUPLICATION: ensure assignedEmployees has no duplicate employeeIds before saving
    if (req.body.assignedEmployees && Array.isArray(req.body.assignedEmployees)) {
      const seen = new Set();
      req.body.assignedEmployees = req.body.assignedEmployees
        .map(e => {
          const empId = getEmpIdStr(e);
          return {
            ...e,
            employeeId: empId && mongoose.Types.ObjectId.isValid(empId) ? empId : (e.employeeId || e._id)
          };
        })
        .filter(e => {
          const id = getEmpIdStr(e);
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
    }

    // Apply updates
    Object.assign(project, req.body);

    // Generate EMI schedule and send email if initial payment is newly registered
    if (req.body.initialPaymentDate && req.body.initialAmount > 0 && req.body.emiPlan > 0 && project.type === 'academic') {
      if (!project.emiSchedule || project.emiSchedule.length === 0) {
        const remainingBalance = Math.max(0, (project.totalCost || 0) - project.initialAmount);
        if (remainingBalance > 0) {
          const emiAmount = remainingBalance / req.body.emiPlan;
          project.emiSchedule = [];
          const initialDate = new Date(req.body.initialPaymentDate);
          
          for (let i = 1; i <= req.body.emiPlan; i++) {
            const dueDate = new Date(initialDate);
            dueDate.setMonth(dueDate.getMonth() + i);
            project.emiSchedule.push({
              dueDate: dueDate,
              amount: parseFloat(emiAmount.toFixed(2)),
              status: 'Pending'
            });
          }
        }
        
        // Send initial payment receipt email
        const studentEmails = (project.assignedMembers || []).map(m => m.email).filter(e => e);
        if (studentEmails.length > 0) {
          // sendInitialPaymentReceipt works asynchronously
          sendInitialPaymentReceipt(studentEmails, project).catch(err => console.error(err));
        }
      }
    }

    if (changes.length > 0) {
      project.timeline.push({
        message: `Project Alert: ${changes.join(', ')}`,
        author: req.user ? req.user.name : "System Admin",
        date: Date.now()
      });
      await notifyHR(req.app, `HR ALERT: Project "${project.title}" metadata updated: ${changes.join(', ')}`, 'info', `/project-details/${project._id}`);
    }

    await project.save();

    // Helper to get all current Team Lead ID strings for this project
    const getProjectTLIds = () => {
      const ids = (project.teamLeads || []).map(t => t.toString());
      if (project.teamLead && !ids.includes(project.teamLead.toString())) {
        ids.push(project.teamLead.toString());
      }
      return [...new Set(ids)];
    };

    // Notify employee assignments (Requirements 2 & 3)
    if (newEmployeeIds.length > 0) {
      const addedUsers = await User.find({ _id: { $in: newEmployeeIds } }).select('name');
      const addedNamesStr = addedUsers.map(u => u.name).join(', ');

      // Notify added employees
      for (const empId of newEmployeeIds) {
        await sendNotification(req.app, empId, `You have been assigned to project: ${project.title}`, 'info', `/project-details/${project._id}`);
      }

      // Notify all other Team Leads assigned to that project when an employee is added
      const currentTLIds = getProjectTLIds();
      const actorId = req.user ? req.user._id.toString() : null;
      const actorName = req.user ? req.user.name : 'System';

      for (const tlId of currentTLIds) {
        if (tlId !== actorId) {
          await sendNotification(
            req.app,
            tlId,
            `New employee(s) (${addedNamesStr}) added to project "${project.title}" by ${actorName}.`,
            'info',
            `/project-details/${project._id}`
          );
        }
      }

      await notifyHR(req.app, `HR ALERT: New employees assigned to project "${project.title}"`, 'info', `/project-details/${project._id}`);
    }

    if (removedEmployeeIds.length > 0) {
      for (const empId of removedEmployeeIds) {
        await sendNotification(req.app, empId, `You have been unassigned from project: ${project.title}`, 'warning', `/project-details/${project._id}`);
      }

      const currentTLIds = getProjectTLIds();
      const actorId = req.user ? req.user._id.toString() : null;
      const actorName = req.user ? req.user.name : 'System';

      for (const tlId of currentTLIds) {
        if (tlId !== actorId) {
          await sendNotification(
            req.app,
            tlId,
            `Employee(s) removed from project "${project.title}" by ${actorName}.`,
            'warning',
            `/project-details/${project._id}`
          );
        }
      }

      await notifyHR(req.app, `HR ALERT: Employees removed from project "${project.title}"`, 'info', `/project-details/${project._id}`);
    }

    // Notify Team Lead assignment changes (Requirements 4 & 5)
    if (newTLIds.length > 0 || removedTLIds.length > 0) {
      await notifyHR(req.app, `HR ALERT: Team Lead assignment changed for project "${project.title}"`, 'info', `/project-details/${project._id}`);

      // Requirement 4: When HR/Admin adds a new Team Lead:
      // - newly added Team Lead(s) receive notification
      // - all existing Team Leads receive notification
      // - all employees assigned to that project receive notification
      if (newTLIds.length > 0) {
        const addedTLUsers = await User.find({ _id: { $in: newTLIds } }).select('name');
        const addedTLNamesStr = addedTLUsers.map(u => u.name).join(', ');

        // Newly added TLs
        for (const tlId of newTLIds) {
          await sendNotification(req.app, tlId, `You have been assigned as a Team Lead for project: ${project.title}`, 'success', `/project-details/${project._id}`);
        }

        // All existing TLs
        for (const tlId of existingTLs) {
          await sendNotification(req.app, tlId, `${addedTLNamesStr} has been assigned as a Team Lead for project "${project.title}".`, 'info', `/project-details/${project._id}`);
        }

        // All assigned employees
        if (project.assignedEmployees && project.assignedEmployees.length > 0) {
          for (const emp of project.assignedEmployees) {
            if (emp.employeeId) {
              await sendNotification(req.app, emp.employeeId, `${addedTLNamesStr} has been assigned as Team Lead for project "${project.title}".`, 'info', `/project-details/${project._id}`);
            }
          }
        }
      }

      // Requirement 5: When HR/Admin removes a Team Lead:
      // - removed Team Lead(s) receive notification
      // - all remaining Team Leads receive notification
      // - all employees assigned to that project receive notification
      if (removedTLIds.length > 0) {
        const removedTLUsers = await User.find({ _id: { $in: removedTLIds } }).select('name');
        const removedTLNamesStr = removedTLUsers.map(u => u.name).join(', ');
        const remainingTLIds = existingTLs.filter(t => !removedTLIds.includes(t));

        // Removed TLs
        for (const tlId of removedTLIds) {
          await sendNotification(req.app, tlId, `You have been unassigned from project: ${project.title}`, 'warning', `/project-details/${project._id}`);
        }

        // Remaining TLs
        for (const tlId of remainingTLIds) {
          await sendNotification(req.app, tlId, `${removedTLNamesStr} has been removed as Team Lead from project "${project.title}".`, 'warning', `/project-details/${project._id}`);
        }

        // All assigned employees
        if (project.assignedEmployees && project.assignedEmployees.length > 0) {
          for (const emp of project.assignedEmployees) {
            if (emp.employeeId) {
              await sendNotification(req.app, emp.employeeId, `${removedTLNamesStr} has been removed as Team Lead for project "${project.title}".`, 'info', `/project-details/${project._id}`);
            }
          }
        }
      }
    }

    // Notify Project Completion
    if (req.body.status && req.body.status.toLowerCase() === 'completed') {
      await notifyHR(req.app, `HR ALERT: Project "${project.title}" status has been marked as Completed!`, 'success', `/project-details/${project._id}`);

      // Notify team leads and employees
      if (project.teamLeads) {
        for (const tlId of project.teamLeads) {
          await sendNotification(req.app, tlId, `CONGRATULATIONS: Project "${project.title}" has been marked Completed!`, 'success', `/project-details/${project._id}`);
        }
      }
      if (project.assignedEmployees) {
        for (const emp of project.assignedEmployees) {
          if (emp.employeeId) {
            await sendNotification(req.app, emp.employeeId, `CONGRATULATIONS: Project "${project.title}" has been marked Completed!`, 'success', `/project-details/${project._id}`);
          }
        }
      }
    }

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System Admin", `Project updated: "${project.title}"`);

    const populatedProject = await Project.findById(project._id)
      .populate('teamLead', 'name email')
      .populate('teamLeads', 'name email')
      .populate('assignedEmployees.employeeId', 'name');
    res.json(populatedProject);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ message: error.message || 'Server error while updating project' });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    await notifyHR(req.app, `HR ALERT: Project "${project.title}" has been deleted.`, 'danger');
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "HR Console", `Project deleted: "${project.title}"`);
    res.json({ message: 'Project removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error while deleting project' });
  }
};

exports.checkUnique = async (req, res) => {
  try {
    const { field, value, excludeId } = req.query;
    if (!field || !value) {
      return res.status(400).json({ message: 'Field and value are required' });
    }

    const query = { [field]: value };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingProject = await Project.findOne(query);
    res.json({ isUnique: !existingProject });
  } catch (error) {
    res.status(500).json({ message: 'Server error while checking uniqueness' });
  }
};

exports.addIssue = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (req.user && req.user.role === 'Employee' && !isEmployeeAssigned(project, req.user)) {
      return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
    }

    // Determine type: If Software Dept (or user software dept), type is Bug, else Issue for Embedded Dept
    let type = req.body.type;
    if (!type) {
      const projDept = (project.department || '').toLowerCase();
      const userDept = req.user && req.user.department ? req.user.department.toLowerCase() : '';
      const userDomain = req.user && req.user.domain ? req.user.domain.toLowerCase() : '';

      if (projDept.includes('software') || userDept.includes('software') || userDomain.includes('software')) {
        type = 'Bug';
      } else {
        type = 'Issue';
      }
    }

    const newIssue = {
      title: req.body.title,
      details: req.body.details,
      priority: req.body.priority || 'Low',
      type: type,
      reportedBy: req.body.reportedBy || (req.user ? req.user.name : "Employee")
    };

    project.issues.push(newIssue);
    const addedIssue = project.issues[project.issues.length - 1];
    const issueId = addedIssue ? addedIssue._id : '';

    project.timeline.push({
      message: `${type} reported: ${newIssue.title}`,
      author: newIssue.reportedBy,
      date: Date.now()
    });
    await project.save();

    // Notify Team Leads
    if (project.teamLeads && project.teamLeads.length > 0) {
      for (const tlId of project.teamLeads) {
        await sendNotification(
          req.app,
          tlId,
          `New ${type.toLowerCase()} reported in ${project.title}: ${newIssue.title}`,
          'warning',
          `/project-details/${project._id}?highlightIssue=${issueId}`
        );
      }
    }

    // Notify HR
    await notifyHR(req.app, `HR ALERT: New ${type.toLowerCase()} reported in project "${project.title}": ${newIssue.title}`, 'warning', `/project-details/${project._id}?highlightIssue=${issueId}`);

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, newIssue.reportedBy, `${type} reported: "${newIssue.title}"`);

    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error adding issue/bug' });
  }
};

exports.resolveIssue = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin');
    const isTL = req.user && req.user.role === 'TeamLead' &&
      (project.teamLeads?.some(tl => tl.toString() === req.user._id.toString()) ||
        project.teamLead?.toString() === req.user._id.toString());

    if (!isHrOrAdmin && !isTL) {
      return res.status(403).json({ message: 'Unauthorized: You do not supervise this project' });
    }

    const issue = project.issues.id(req.params.issueId);
    if (issue) {
      issue.status = 'Closed';
      project.timeline.push({
        message: `${issue.type} resolved: ${issue.title}`,
        author: req.user ? req.user.name : "System Admin",
        date: Date.now()
      });
      await project.save();

      // Notify reporting employee
      if (issue.reportedBy) {
        const reportingUser = await User.findOne({ name: { $regex: new RegExp(`^${issue.reportedBy.trim()}$`, 'i') } });
        if (reportingUser) {
          await sendNotification(
            req.app,
            reportingUser._id,
            `Your reported ${issue.type.toLowerCase()} ("${issue.title}") in project "${project.title}" has been resolved.`,
            'success',
            `/project-details/${project._id}?highlightIssue=${issue._id}`
          );
        }
      }

      // Also notify assigned employees on project
      if (project.assignedEmployees && project.assignedEmployees.length > 0) {
        for (const emp of project.assignedEmployees) {
          const empId = emp.employeeId || emp._id;
          if (empId) {
            await sendNotification(
              req.app,
              empId,
              `${issue.type} resolved in project "${project.title}": "${issue.title}"`,
              'success',
              `/project-details/${project._id}?highlightIssue=${issue._id}`
            );
          }
        }
      }

      // Notify HR
      await notifyHR(req.app, `HR ALERT: ${issue.type} resolved in project "${project.title}": ${issue.title}`, 'success', `/project-details/${project._id}?highlightIssue=${issue._id}`);

      // Log Activity
      await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System Admin", `${issue.type} resolved: "${issue.title}"`);
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error resolving issue' });
  }
};

exports.deleteIssue = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const issue = project.issues.id(req.params.issueId);
    const type = issue ? issue.type : 'Issue';

    project.issues.pull(req.params.issueId);
    project.timeline.push({
      message: `${type} and escalation record deleted by Admin`,
      author: req.user ? req.user.name : "Admin",
      date: Date.now()
    });

    await project.save();

    // Notify HR
    await notifyHR(req.app, `HR ALERT: ${type} deleted from project "${project.title}" by Admin`, 'danger');

    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting issue' });
  }
};

exports.escalateIssue = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin');
    const isTL = req.user && req.user.role === 'TeamLead' &&
      (project.teamLeads?.some(tl => tl.toString() === req.user._id.toString()) ||
        project.teamLead?.toString() === req.user._id.toString());

    if (!isHrOrAdmin && !isTL) {
      return res.status(403).json({ message: 'Unauthorized: You do not supervise this project' });
    }

    const issue = project.issues.id(req.params.issueId);
    if (issue) {
      issue.status = 'Escalated';
      await project.save();

      // Notify all HR and Admin users
      const escalatedUsers = await User.find({ role: { $in: ['Admin', 'HR'] } });
      for (const u of escalatedUsers) {
        await sendNotification(
          req.app,
          u._id,
          `ESCALATION: Urgent ${issue.type.toLowerCase()} in project ${project.title}: ${issue.title}`,
          'danger',
          `/project-details/${project._id}?highlightIssue=${issue._id}`
        );
      }
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error escalating issue' });
  }
};

exports.nudgeIssue = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const issue = project.issues.id(req.params.issueId);
    if (issue && issue.status === 'Escalated') {
      // Notify HR users directly
      await notifyHR(
        req.app,
        `ADMIN ALERT: Action required on escalated ${issue.type.toLowerCase()} in ${project.title}: ${issue.title}`,
        'danger',
        `/project-details/${project._id}?highlightIssue=${issue._id}`
      );
    }
    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error nudging issue' });
  }
};

exports.addPayment = async (req, res) => {
  try {
    if (req.user && !['Admin', 'Accounts'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized: Only Admin and Accounts can record payments' });
    }

    // Enforce that payment date must not be in the future
    const submittedDate = req.body.date ? new Date(req.body.date) : null;
    if (!submittedDate || isNaN(submittedDate.getTime())) {
      return res.status(400).json({ message: 'A valid payment date is required' });
    }
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    if (submittedDate > now) {
      return res.status(400).json({ message: 'EMI payments cannot be recorded for a future date' });
    }

    const project = await Project.findById(req.params.id);
    project.payments.push(req.body);

    // Mark the oldest pending EMI schedule as Paid
    if (project.emiSchedule && project.emiSchedule.length > 0) {
      const pendingEmi = project.emiSchedule.find(emi => emi.status === 'Pending');
      if (pendingEmi) {
        pendingEmi.status = 'Paid';
      }
    }

    await project.save();

    // Send EMI Payment receipt email if academic project
    if (project.type === 'academic') {
      const studentEmails = (project.assignedMembers || []).map(m => m.email).filter(e => e);
      if (studentEmails.length > 0) {
        const nextEmi = (project.emiSchedule || []).find(emi => emi.status === 'Pending');
        sendEmiPaymentReceipt(studentEmails, project, req.body.amount, nextEmi).catch(err => console.error(err));
      }
    }

    // Notify HR
    await notifyHR(req.app, `HR ALERT: New payment logged for project "${project.title}": ₹${req.body.amount}`, 'success', `/project-details/${project._id}`);

    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error adding payment' });
  }
};


exports.addTimelineLog = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin' || req.user.role === 'Accounts');
    const isTL = req.user && (
      req.user.role === 'TeamLead' ||
      project.teamLeads?.some(tl => tl.toString() === req.user._id.toString()) ||
      project.teamLead?.toString() === req.user._id.toString()
    );
    const isAssigned = isEmployeeAssigned(project, req.user);

    if (!isHrOrAdmin && !isTL && !isAssigned) {
      return res.status(403).json({ message: 'Unauthorized: You are not assigned to this project' });
    }

    project.timeline.push({
      message: req.body.message,
      author: req.body.author,
      date: req.body.date || Date.now()
    });
    const addedLog = project.timeline[project.timeline.length - 1];
    const logId = addedLog ? addedLog._id : '';

    if (req.body.notifyTeam) {
      const userIdsToNotify = new Set();

      // Notify Team Leads if exist
      if (project.teamLeads) {
        project.teamLeads.forEach(tl => userIdsToNotify.add(tl.toString()));
      }
      if (project.teamLead) {
        userIdsToNotify.add(project.teamLead.toString());
      }

      // Notify assigned employees
      if (project.assignedEmployees && project.assignedEmployees.length > 0) {
        project.assignedEmployees.forEach(emp => {
          if (emp.employeeId) {
            userIdsToNotify.add(emp.employeeId.toString());
          }
        });
      }

      if (req.user) {
        userIdsToNotify.delete(req.user._id.toString());
      }

      for (const userId of Array.from(userIdsToNotify)) {
        await sendNotification(
          req.app,
          userId,
          `Project Update (${project.title}): ${req.body.message}`,
          'info',
          `/project-details/${project._id}?highlightTimeline=${logId}`
        );
      }
    }

    await project.save();

    // Notify HR
    await notifyHR(req.app, `HR ALERT: Project "${project.title}" timeline log added: "${req.body.message}"`, 'info', `/project-details/${project._id}?highlightTimeline=${logId}`);

    const populatedProject = await Project.findById(project._id)
      .populate('teamLead', 'name email')
      .populate('teamLeads', 'name email')
      .populate('assignedEmployees.employeeId', 'name');
    res.json(populatedProject);
  } catch (error) {
    console.error("Timeline log error", error);
    res.status(500).json({ message: 'Server error adding timeline log' });
  }
};

exports.uploadDocument = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (req.user && req.user.role === 'Employee' && !isEmployeeAssigned(project, req.user)) {
      return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
    }

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Automatically Compress File on Upload
    const compressionData = await compressFile(req.file.path);

    const newDoc = {
      name: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      size: compressionData.compressedSize,
      isCompressed: true,
      originalSize: compressionData.originalSize,
      compressedSize: compressionData.compressedSize,
      uploadedBy: req.user ? req.user.name : "Unknown",
    };
    project.documents.push(newDoc);
    await project.save();

    // Notify HR
    await notifyHR(req.app, `HR ALERT: Document "${req.file.originalname}" uploaded to project "${project.title}"`, 'info', `/project-details/${project._id}`);

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "Unknown", `Document uploaded: ${req.file.originalname}`);

    res.json(project);
  } catch (error) {
    console.error("Doc upload fail:", error);
    res.status(500).json({ message: 'Server error uploading document' });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const docIndex = project.documents.findIndex(d => (d._id && d._id.toString() === req.params.docId) || d.id === req.params.docId);
    if (docIndex === -1) return res.status(404).json({ message: 'Document not found' });

    const doc = project.documents[docIndex];

    if (doc.url) {
      const filename = path.basename(doc.url);
      const filePath = path.join(__dirname, '../uploads', filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      if (fs.existsSync(filePath + '.gz')) {
        try { fs.unlinkSync(filePath + '.gz'); } catch (e) {}
      }
    }

    project.documents.splice(docIndex, 1);
    await project.save();

    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "Unknown", `Document deleted: ${doc.name}`);

    res.json(project);
  } catch (error) {
    console.error("Doc delete fail:", error);
    res.status(500).json({ message: 'Server error deleting document' });
  }
};


exports.requestHardware = async (req, res) => {
  try {
    if (req.user && req.user.role === 'TeamLead') {
      return res.status(403).json({ message: 'Team Leads are not permitted to submit component stock requests.' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (req.user && req.user.role === 'Employee' && !isEmployeeAssigned(project, req.user)) {
      return res.status(403).json({ message: 'Access denied: You are not assigned to this project' });
    }

    const requestedBy = req.body.requestedBy || (req.user ? req.user.name : 'Employee');
    let itemsToProcess = [];

    if (Array.isArray(req.body.items) && req.body.items.length > 0) {
      itemsToProcess = req.body.items.filter(i => (i.name || i.customName) && parseInt(i.quantity) > 0).map(i => ({
        name: i.name || i.customName,
        quantity: parseInt(i.quantity),
        reason: i.reason || "Project Requirement"
      }));
    } else if (req.body.name && req.body.quantity) {
      itemsToProcess = [{
        name: req.body.name,
        quantity: parseInt(req.body.quantity),
        reason: req.body.reason || "Project Requirement"
      }];
    }

    if (itemsToProcess.length === 0) {
      return res.status(400).json({ message: 'No valid component items provided' });
    }

    for (const item of itemsToProcess) {
      const hwRequest = {
        name: item.name,
        quantity: item.quantity,
        reason: item.reason,
        requestedBy: requestedBy
      };

      project.hardwareRequests.push(hwRequest);

      // Auto-log to timeline
      project.timeline.push({
        message: `Hardware Request: ${item.name} (Qty: ${item.quantity})`,
        author: requestedBy,
        date: Date.now()
      });

      // Log Activity
      await logActivity(project._id, project.title, req.user ? req.user._id : null, requestedBy, `Component requested: ${item.name} (Qty: ${item.quantity})`);
    }

    await project.save();

    // Notify Team Leads & HR
    const summaryList = itemsToProcess.map(i => `${i.name} (Qty: ${i.quantity})`).join(', ');
    if (project.teamLeads && project.teamLeads.length > 0) {
      for (const tlId of project.teamLeads) {
        await sendNotification(
          req.app,
          tlId,
          `New component request in ${project.title}: ${summaryList}`,
          'info',
          `/project-details/${project._id}`
        );
      }
    }

    await notifyHR(req.app, `HR ALERT: Component request submitted in "${project.title}": ${summaryList}`, 'info', `/project-details/${project._id}`);

    res.json(project);
  } catch (error) {
    console.error("Hardware request error:", error);
    res.status(500).json({ message: 'Server error requesting hardware' });
  }
};

exports.approveHardware = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin');
    const isTL = req.user && req.user.role === 'TeamLead' &&
      (project.teamLeads?.some(tl => tl.toString() === req.user._id.toString()) ||
        project.teamLead?.toString() === req.user._id.toString());

    if (!isHrOrAdmin && !isTL) {
      return res.status(403).json({ message: 'Unauthorized: Only Team Leads or HR can approve hardware' });
    }

    let request = project.hardwareRequests.id(req.params.reqId);
    const InventoryItem = require('../models/InventoryItem');
    const ComponentRequest = require('../models/ComponentRequest');

    if (!request) {
      // Check if it's a ComponentRequest
      const compReq = await ComponentRequest.findById(req.params.reqId).populate('items.itemId employeeId');
      if (compReq) {
        if (compReq.status !== 'Pending TL') {
          return res.status(400).json({ message: 'This request has already been reviewed.' });
        }

        for (const reqItem of compReq.items) {
          const invItem = await InventoryItem.findById(reqItem.itemId?._id || reqItem.itemId);
          if (invItem) {
            if (invItem.availableQuantity < reqItem.quantity) {
              return res.status(400).json({
                message: `Insufficient stock for ${invItem.name}. Cannot approve.`
              });
            }
            invItem.availableQuantity -= reqItem.quantity;
            invItem.totalQuantity -= reqItem.quantity;
            await invItem.save();
          }

          const compName = reqItem.itemId?.name || 'Component';
          const existingInv = project.inventory.find(i => i.name.toLowerCase() === compName.toLowerCase());
          if (existingInv) {
            existingInv.quantity += reqItem.quantity;
            existingInv.lastUpdated = Date.now();
          } else {
            project.inventory.push({
              name: compName,
              quantity: reqItem.quantity,
              lastUpdated: Date.now()
            });
          }

          project.timeline.push({
            message: `Hardware Approved: ${compName} (Qty: ${reqItem.quantity})`,
            author: req.user ? req.user.name : 'Team Leader',
            date: Date.now()
          });
        }

        compReq.status = 'Approved by TL';
        compReq.tlComments = req.body.reason || 'Approved';
        await compReq.save();
        await project.save();

        await notifyHR(req.app, `HR ALERT: Component request approved on project "${project.title}".`, 'success', `/project-details/${project._id}`);
        if (compReq.employeeId) {
          await sendNotification(req.app, compReq.employeeId._id || compReq.employeeId, `Component Approved: Your component request for ${project.title} has been approved.`, 'success', `/project-details/${project._id}`);
        }

        await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System", `Component request approved`);
        return res.json(project);
      }
      return res.status(404).json({ message: 'Request not found' });
    }

    // Guardrail: approved quantity initially matches requested quantity.
    // The Team Lead may reduce the approved quantity, but cannot increase it.
    const approvedQty = req.body.quantity !== undefined ? parseInt(req.body.quantity) : request.quantity;
    if (approvedQty > request.quantity) {
      return res.status(400).json({ message: `Approved quantity cannot exceed requested quantity (${request.quantity})` });
    }

    // Deduct from main inventory if matching item exists
    const invItem = await InventoryItem.findOne({ name: { $regex: new RegExp(`^${request.name}$`, 'i') } });
    if (invItem) {
      if (invItem.availableQuantity < approvedQty) {
        return res.status(400).json({
          message: `Insufficient stock in inventory for ${invItem.name}. Available: ${invItem.availableQuantity}`
        });
      }
      invItem.availableQuantity -= approvedQty;
      invItem.totalQuantity -= approvedQty;
      await invItem.save();

      // Low Stock Alert
      if (invItem.availableQuantity <= invItem.minThreshold) {
        const recipients = await User.find({ role: { $in: ['Accounts', 'HR'] } });
        for (const recipient of recipients) {
          const existing = await Notification.findOne({
            user: recipient._id,
            message: `Low Stock Alert: ${invItem.name} is low on stock (${invItem.availableQuantity} left).`,
            read: false
          });
          if (!existing) {
            await Notification.create({
              user: recipient._id,
              message: `Low Stock Alert: ${invItem.name} is low on stock (${invItem.availableQuantity} left).`,
              sender: 'Inventory System',
              type: 'danger',
              link: `/inventory-dashboard?search=${encodeURIComponent(invItem.name)}`
            });
          }
        }
      }
    }

    request.status = 'Approved';
    request.quantity = approvedQty; // store actual approved qty

    // Add or update inventory
    const existingInv = project.inventory.find(i => i.name.toLowerCase() === request.name.toLowerCase());
    if (existingInv) {
      existingInv.quantity += approvedQty;
      existingInv.lastUpdated = Date.now();
    } else {
      project.inventory.push({
        name: request.name,
        quantity: approvedQty,
        lastUpdated: Date.now()
      });
    }

    // Auto-log to timeline
    project.timeline.push({
      message: `Hardware Approved: ${request.name} (Qty: ${approvedQty})`,
      author: req.user ? req.user.name : 'Team Leader',
      date: Date.now()
    });

    // Notify HR (issued to employee means approved & available)
    await notifyHR(
      req.app,
      `HR ALERT: Component "${request.name}" (Qty: ${approvedQty}) has been approved/issued to team on "${project.title}".`,
      'success',
      `/project-details/${project._id}`
    );

    // Notify the employee who requested it
    if (request.requestedBy) {
      const employee = await User.findOne({ name: request.requestedBy });
      if (employee) {
        await sendNotification(
          req.app,
          employee._id,
          `Component Approved: Your request for ${request.name} in ${project.title} has been approved (Qty: ${approvedQty}).`,
          'success',
          `/project-details/${project._id}`
        );
      }
    }

    await project.save();

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System", `Component approved: ${request.name} (Qty: ${approvedQty})`);

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error approving hardware' });
  }
};

exports.rejectHardware = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isHrOrAdmin = req.user && (req.user.role === 'HR' || req.user.role === 'Admin');
    const isTL = req.user && req.user.role === 'TeamLead' &&
      (project.teamLeads?.some(tl => tl.toString() === req.user._id.toString()) ||
        project.teamLead?.toString() === req.user._id.toString());

    if (!isHrOrAdmin && !isTL) {
      return res.status(403).json({ message: 'Unauthorized: Only Team Leads or HR can reject hardware' });
    }

    let request = project.hardwareRequests.id(req.params.reqId);
    const rejectionReason = req.body.reason || "No specific reason provided";

    if (!request) {
      const ComponentRequest = require('../models/ComponentRequest');
      const compReq = await ComponentRequest.findById(req.params.reqId);
      if (compReq) {
        compReq.status = 'Rejected by TL';
        compReq.tlComments = rejectionReason;
        await compReq.save();

        project.timeline.push({
          message: `Hardware Rejected. Reason: ${rejectionReason}`,
          author: req.user ? req.user.name : 'Team Leader',
          date: Date.now()
        });
        await project.save();

        await notifyHR(req.app, `HR ALERT: Component request rejected on "${project.title}". Reason: ${rejectionReason}`, 'warning', `/project-details/${project._id}`);
        if (compReq.employeeId) {
          await sendNotification(req.app, compReq.employeeId, `Component Request Rejected in ${project.title}. Reason: ${rejectionReason}`, 'danger', `/project-details/${project._id}`);
        }

        await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System", `Component request rejected`);
        return res.json(project);
      }
      return res.status(404).json({ message: 'Request not found' });
    }

    request.status = 'Rejected';

    project.timeline.push({
      message: `Hardware Rejected: ${request.name}. Reason: ${rejectionReason}`,
      author: req.user ? req.user.name : 'Team Leader',
      date: Date.now()
    });

    // Notify HR
    await notifyHR(
      req.app,
      `HR ALERT: Hardware request rejected in project ${project.title} for ${request.name}. Reason: ${rejectionReason}`,
      'warning',
      `/project-details/${project._id}`
    );

    // Notify employee
    if (request.requestedBy) {
      const employee = await User.findOne({ name: request.requestedBy });
      if (employee) {
        await sendNotification(
          req.app,
          employee._id,
          `Hardware Request Rejected: Your request for ${request.name} in ${project.title} was rejected. Reason: ${rejectionReason}`,
          'danger',
          `/project-details/${project._id}`
        );
      }
    }

    await project.save();

    // Log Activity
    await logActivity(project._id, project.title, req.user ? req.user._id : null, req.user ? req.user.name : "System", `Component request rejected: ${request.name}`);

    res.json(project);
  } catch (error) {
    res.status(500).json({ message: 'Server error rejecting hardware' });
  }
};

// HR approves completed project employee request
exports.approveEmployeeRequest = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const reqId = req.params.reqId;
    const request = project.employeeApprovalRequests.id(reqId);
    if (!request) return res.status(404).json({ message: 'Employee request not found' });

    request.status = 'approved';

    const empObj = {
      employeeId: request.employeeId,
      name: request.name,
      role: request.role,
      contact: request.contact,
      phone: request.phone,
      status: 'Active'
    };

    if (request.action === 'assign') {
      const alreadyAssigned = project.assignedEmployees.some(e => e.employeeId?.toString() === request.employeeId.toString());
      if (!alreadyAssigned) {
        project.assignedEmployees.push(empObj);
      }
    } else if (request.action === 'remove') {
      project.assignedEmployees = project.assignedEmployees.filter(e => e.employeeId?.toString() !== request.employeeId.toString());
    }

    project.timeline.push({
      message: `Completed Project: Employee ${request.name} ${request.action} approved by HR`,
      author: req.user.name,
      date: Date.now()
    });

    await project.save();

    // Notify requesting Team Leads
    if (project.teamLeads) {
      for (const tlId of project.teamLeads) {
        await sendNotification(req.app, tlId, `Approved: HR approved requested "${request.action}" for ${request.name} in completed project "${project.title}".`, 'success', `/project-details/${project._id}`);
      }
    }

    // Notify employee
    await sendNotification(req.app, request.employeeId, `Completed Project Alert: You have been ${request.action === 'assign' ? 'assigned to' : 'removed from'} completed project "${project.title}".`, 'info', `/project-details/${project._id}`);

    // Log Activity
    await logActivity(project._id, project.title, req.user._id, req.user.name, `Completed project: employee ${request.name} ${request.action} approved`);

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error approving employee request' });
  }
};

// HR rejects completed project employee request
exports.rejectEmployeeRequest = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const reqId = req.params.reqId;
    const request = project.employeeApprovalRequests.id(reqId);
    if (!request) return res.status(404).json({ message: 'Employee request not found' });

    request.status = 'rejected';

    project.timeline.push({
      message: `Completed Project: Employee ${request.name} ${request.action} rejected by HR`,
      author: req.user.name,
      date: Date.now()
    });

    await project.save();

    // Notify Team Leads
    if (project.teamLeads) {
      for (const tlId of project.teamLeads) {
        await sendNotification(req.app, tlId, `Rejected: HR rejected requested "${request.action}" for ${request.name} in completed project "${project.title}".`, 'danger', `/project-details/${project._id}`);
      }
    }

    // Log Activity
    await logActivity(project._id, project.title, req.user._id, req.user.name, `Completed project: employee ${request.name} ${request.action} rejected`);

    res.json(project);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error rejecting employee request' });
  }
};

exports.checkEmiReminders = async (app) => {
  try {
    console.log("Running EMI reminders check...");
    const projects = await Project.find({});
    const accountsUsers = await User.find({ role: 'Accounts' });
    if (accountsUsers.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const project of projects) {
      const total = project.totalCost || 0;
      const initial = project.initialAmount || 0;
      const emiPlan = project.emiPlan || 1;
      const emiTarget = total - initial;

      if (total <= 0 || emiTarget <= 0) continue;

      const payments = project.payments || [];
      const paid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

      // If fully paid, skip
      if (paid >= emiTarget) continue;

      const emiAmount = emiTarget / emiPlan;
      const startDate = new Date(project.startDate || project.createdAt);

      // Check each installment
      for (let i = 1; i <= emiPlan; i++) {
        // Calculate date of this installment (i months after startDate)
        const installmentDate = new Date(startDate);
        installmentDate.setMonth(startDate.getMonth() + i);
        installmentDate.setHours(0, 0, 0, 0);

        // Expected cumulative paid amount by this installment
        const expectedCumulative = i * emiAmount;

        // If the client has paid less than this, this installment is unpaid
        if (paid < expectedCumulative) {
          // Send reminder if today is installmentDate or if it is overdue
          const diffTime = today.getTime() - installmentDate.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          // If installmentDate is today, or passed
          if (diffDays >= 0) {
            const dateStr = installmentDate.toLocaleDateString('en-IN');
            const isToday = diffDays === 0;
            const message = isToday
              ? `EMI REMINDER: Project "${project.title}" has an EMI of ₹${emiAmount.toFixed(2)} due today!`
              : `EMI OVERDUE: Project "${project.title}" has a pending EMI of ₹${emiAmount.toFixed(2)} overdue since ${dateStr}!`;

            // Notify all Accounts users
            for (const acc of accountsUsers) {
              // Avoid duplicates: Check if a notification with this message was sent to this user in the last 12 hours
              const existingNotif = await Notification.findOne({
                user: acc._id,
                message: message,
                createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
              });

              if (!existingNotif) {
                await sendNotification(app, acc._id, message, 'warning', `/project-payments`);
              }
            }
          }
          // Break so we only warn for the oldest unpaid installment
          break;
        }
      }
    }
    console.log("EMI reminders check completed.");
  } catch (err) {
    console.error("Error in checkEmiReminders:", err);
  }
};

exports.checkDeadlineReminders = async (app) => {
  try {
    console.log("Running project deadline reminders check...");
    const projects = await Project.find({
      status: { $nin: ['completed', 'cancelled'] },
      deadline: { $exists: true, $ne: null }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const project of projects) {
      const deadline = new Date(project.deadline);
      deadline.setHours(0, 0, 0, 0);

      const diffTime = deadline.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Starting 5 days before the deadline up to the deadline day (0 days left)
      if (diffDays >= 0 && diffDays <= 5) {
        const daysText = diffDays === 0 ? "today" : `in ${diffDays} days`;
        const dateStr = deadline.toLocaleDateString('en-IN');
        const message = `Upcoming Deadline: Project "${project.title}" is due ${daysText} (Deadline: ${dateStr}).`;

        // Gather all respective Team Leads and Employees
        const userIds = new Set();

        if (project.teamLeads) {
          project.teamLeads.forEach(tl => userIds.add(tl.toString()));
        }
        if (project.teamLead) {
          userIds.add(project.teamLead.toString());
        }

        if (project.assignedEmployees) {
          project.assignedEmployees.forEach(emp => {
            if (emp.employeeId && emp.status === 'Active') {
              userIds.add(emp.employeeId.toString());
            }
          });
        }

        for (const userId of userIds) {
          // Avoid duplicate reminders within the last 12 hours
          const existingNotif = await Notification.findOne({
            user: userId,
            message: message,
            createdAt: { $gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
          });

          if (!existingNotif) {
            await sendNotification(app, userId, message, 'danger', `/project-details/${project._id}`);
          }
        }
      }
    }
    console.log("Project deadline reminders check completed.");
  } catch (err) {
    console.error("Error in checkDeadlineReminders:", err);
  }
};
