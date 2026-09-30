const WeeklyPlan = require('../models/WeeklyPlan');
const Notification = require('../models/Notification');
const User = require('../models/User');

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
      io.to(userId.toString()).emit('new-notification', socketPayload);
    }
  } catch (err) {
    console.error("WeeklyPlan notification error:", err);
  }
};

// Helper to notify all Admin and HR members
const notifyAdminsAndHR = async (app, message, type = 'info', link = '') => {
  try {
    const adminHrUsers = await User.find({ role: { $in: ['HR', 'Admin'] } });
    for (const u of adminHrUsers) {
      await sendNotification(app, u._id, message, type, link);
    }
  } catch (err) {
    console.error("WeeklyPlan notify Admin & HR error:", err);
  }
};

// Create / Submit a new Weekly Plan (Team Leads, Admin, HR)
exports.createWeeklyPlan = async (req, res) => {
  try {
    const {
      title,
      weekStartDate,
      weekEndDate,
      department,
      projectPlans,
      generalObjectives,
      blockersAndDependencies,
      status
    } = req.body;

    if (!title || !weekStartDate || !weekEndDate) {
      return res.status(400).json({ message: 'Title, week start date, and week end date are required.' });
    }

    const plan = new WeeklyPlan({
      teamLead: req.user._id,
      department: department || req.user.department || 'General',
      title,
      weekStartDate: new Date(weekStartDate),
      weekEndDate: new Date(weekEndDate),
      projectPlans: Array.isArray(projectPlans) ? projectPlans : [],
      generalObjectives: generalObjectives || '',
      blockersAndDependencies: blockersAndDependencies || '',
      status: status === 'Draft' ? 'Draft' : 'Submitted',
      submittedAt: new Date()
    });

    await plan.save();

    const populatedPlan = await WeeklyPlan.findById(plan._id)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate({
        path: 'projectPlans.assignedEmployees',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email department designation status'
      });

    // Notify Admin and HR if plan is submitted
    if (plan.status === 'Submitted') {
      const tlName = req.user.name || 'Team Lead';
      await notifyAdminsAndHR(
        req.app,
        `WEEKLY PLAN: ${tlName} submitted next week's work plan: "${plan.title}"`,
        'info',
        `/weekly-plans/${plan._id}`
      );
    }

    res.status(201).json(populatedPlan);
  } catch (error) {
    console.error("Create Weekly Plan Error:", error);
    res.status(500).json({ message: 'Server error while creating weekly plan' });
  }
};

// Get current user's submitted weekly plans (for Team Leads) or assigned/department plans (for Employees)
exports.getMyWeeklyPlans = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'TeamLead') {
      query = { teamLead: req.user._id };
    } else if (req.user.role === 'Employee') {
      const conditions = [
        { 'projectPlans.assignedEmployees': req.user._id }
      ];
      if (req.user.department && req.user.department.trim()) {
        conditions.push({ department: new RegExp(`^${req.user.department.trim()}$`, 'i') });
      }
      query = {
        status: { $in: ['Submitted', 'Reviewed'] },
        $or: conditions
      };
    } else if (['Admin', 'HR'].includes(req.user.role)) {
      query = {};
    } else {
      query = {
        status: { $in: ['Submitted', 'Reviewed'] },
        $or: [
          { 'projectPlans.assignedEmployees': req.user._id },
          { department: new RegExp(`^${(req.user.department || '').trim()}$`, 'i') }
        ]
      };
    }

    const plans = await WeeklyPlan.find(query)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate({
        path: 'projectPlans.assignedEmployees',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email department designation status'
      })
      .populate({
        path: 'projectPlans.completedBy.employee',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email'
      })
      .populate('adminHrRemarks.user', 'name role')
      .sort({ weekStartDate: -1 });

    plans.forEach(p => {
      if (p.projectPlans) {
        p.projectPlans.forEach(pp => {
          if (pp.assignedEmployees) {
            pp.assignedEmployees = pp.assignedEmployees.filter(Boolean);
          }
        });
      }
    });

    res.json(plans);
  } catch (error) {
    console.error("Get My Weekly Plans Error:", error);
    res.status(500).json({ message: 'Server error while fetching your weekly plans' });
  }
};

// Get all weekly plans (for Admin & HR) with filters
exports.getAllWeeklyPlans = async (req, res) => {
  try {
    let filter = {};

    if (req.query.department) {
      filter.department = new RegExp(`^${req.query.department}$`, 'i');
    }
    if (req.query.teamLead) {
      filter.teamLead = req.query.teamLead;
    }
    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.startDate && req.query.endDate) {
      filter.weekStartDate = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const plans = await WeeklyPlan.find(filter)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate({
        path: 'projectPlans.assignedEmployees',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email department designation status'
      })
      .populate({
        path: 'projectPlans.completedBy.employee',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email'
      })
      .populate('adminHrRemarks.user', 'name role')
      .sort({ weekStartDate: -1 });

    plans.forEach(p => {
      if (p.projectPlans) {
        p.projectPlans.forEach(pp => {
          if (pp.assignedEmployees) {
            pp.assignedEmployees = pp.assignedEmployees.filter(Boolean);
          }
        });
      }
    });

    res.json(plans);
  } catch (error) {
    console.error("Get All Weekly Plans Error:", error);
    res.status(500).json({ message: 'Server error while fetching all weekly plans' });
  }
};

// Get a single weekly plan by ID
exports.getWeeklyPlanById = async (req, res) => {
  try {
    const plan = await WeeklyPlan.findById(req.params.id)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate({
        path: 'projectPlans.assignedEmployees',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email department designation status'
      })
      .populate({
        path: 'projectPlans.completedBy.employee',
        match: { status: { $ne: 'Inactive' } },
        select: 'name email'
      })
      .populate('adminHrRemarks.user', 'name role')
      .populate('reviewedBy', 'name email role');

    if (plan && plan.projectPlans) {
      plan.projectPlans.forEach(pp => {
        if (pp.assignedEmployees) {
          pp.assignedEmployees = pp.assignedEmployees.filter(Boolean);
        }
      });
    }

    if (!plan) {
      return res.status(404).json({ message: 'Weekly plan not found' });
    }

    const isAdminOrHr = ['Admin', 'HR'].includes(req.user.role);
    const isOwner = plan.teamLead && plan.teamLead._id.toString() === req.user._id.toString();

    // Check if employee is assigned or in the same department
    let isAssignedEmployee = false;
    if (plan.projectPlans && plan.projectPlans.length > 0) {
      isAssignedEmployee = plan.projectPlans.some(pp =>
        (pp.assignedEmployees || []).some(emp =>
          (emp._id ? emp._id.toString() : emp.toString()) === req.user._id.toString()
        )
      );
    }
    const isSameDept = req.user.department && plan.department &&
      plan.department.toLowerCase() === req.user.department.toLowerCase();

    const isVisibleToEmployee = ['Submitted', 'Reviewed'].includes(plan.status) && (isAssignedEmployee || isSameDept);

    if (!isAdminOrHr && !isOwner && !isVisibleToEmployee) {
      return res.status(403).json({ message: 'Access denied: You are not authorized to view this weekly plan' });
    }

    res.json(plan);
  } catch (error) {
    console.error("Get Weekly Plan Error:", error);
    res.status(500).json({ message: 'Server error while fetching weekly plan' });
  }
};

// Update a Weekly Plan (Team Lead edits draft/plan, or Admin/HR reviews & adds remarks)
exports.updateWeeklyPlan = async (req, res) => {
  try {
    const plan = await WeeklyPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Weekly plan not found' });
    }

    const isAdminOrHr = ['Admin', 'HR'].includes(req.user.role);
    const isOwner = plan.teamLead && plan.teamLead.toString() === req.user._id.toString();

    if (!isAdminOrHr && !isOwner) {
      return res.status(403).json({ message: 'Unauthorized to update this weekly plan' });
    }

    const prevStatus = plan.status;

    // Team Lead updating their plan fields
    if (isOwner) {
      if (req.body.title) plan.title = req.body.title;
      if (req.body.weekStartDate) plan.weekStartDate = new Date(req.body.weekStartDate);
      if (req.body.weekEndDate) plan.weekEndDate = new Date(req.body.weekEndDate);
      if (req.body.department) plan.department = req.body.department;
      if (Array.isArray(req.body.projectPlans)) plan.projectPlans = req.body.projectPlans;
      if (req.body.generalObjectives !== undefined) plan.generalObjectives = req.body.generalObjectives;
      if (req.body.blockersAndDependencies !== undefined) plan.blockersAndDependencies = req.body.blockersAndDependencies;
      if (req.body.status && ['Draft', 'Submitted'].includes(req.body.status)) {
        plan.status = req.body.status;
      }
    }

    // Admin or HR adding remarks or marking as Reviewed
    if (isAdminOrHr) {
      if (req.body.remark && req.body.remark.trim()) {
        plan.adminHrRemarks.push({
          user: req.user._id,
          name: req.user.name || req.user.role,
          comment: req.body.remark.trim(),
          date: new Date()
        });
      }
      if (req.body.status && ['Submitted', 'Reviewed'].includes(req.body.status)) {
        plan.status = req.body.status;
        plan.reviewedBy = req.user._id;
      }
    }

    await plan.save();

    const updatedPlan = await WeeklyPlan.findById(plan._id)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate('projectPlans.assignedEmployees', 'name email department')
      .populate('projectPlans.completedBy.employee', 'name email')
      .populate('adminHrRemarks.user', 'name role')
      .populate('reviewedBy', 'name email role');

    // Notify Admin/HR if transitioned from Draft to Submitted
    if (isOwner && prevStatus === 'Draft' && plan.status === 'Submitted') {
      await notifyAdminsAndHR(
        req.app,
        `WEEKLY PLAN SUBMITTED: ${req.user.name} submitted plan: "${plan.title}"`,
        'info',
        `/weekly-plans/${plan._id}`
      );
    }

    // Notify Team Lead if Admin or HR added feedback/remarks or reviewed
    if (isAdminOrHr && (req.body.remark || req.body.status === 'Reviewed')) {
      const reviewerName = req.user.name || req.user.role;
      await sendNotification(
        req.app,
        plan.teamLead,
        `WEEKLY PLAN REVIEW: ${reviewerName} reviewed your plan "${plan.title}"`,
        'success',
        `/weekly-plans/${plan._id}`
      );
    }

    res.json(updatedPlan);
  } catch (error) {
    console.error("Update Weekly Plan Error:", error);
    res.status(500).json({ message: 'Server error while updating weekly plan' });
  }
};

// Mark a task as complete / uncomplete by an assigned employee
exports.markTaskComplete = async (req, res) => {
  try {
    const { planId, taskId } = req.params;
    const { note = '' } = req.body;
    const employeeId = req.user._id;

    const plan = await WeeklyPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: 'Weekly plan not found' });
    }

    const taskPlan = plan.projectPlans.id(taskId);
    if (!taskPlan) {
      return res.status(404).json({ message: 'Task not found in this weekly plan' });
    }

    if (['HR', 'Admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Admin and HR have view-only access to weekly plan checklist' });
    }

    const isAssigned = (taskPlan.assignedEmployees || []).some(
      emp => (emp._id ? emp._id.toString() : emp.toString()) === employeeId.toString()
    );
    const isSameDept = req.user.department && plan.department &&
      plan.department.toLowerCase() === req.user.department.toLowerCase();
    const isTeamLead = req.user.role === 'TeamLead' ||
      (plan.teamLead && plan.teamLead.toString() === employeeId.toString());

    if (!isAssigned && !isSameDept && !isTeamLead && req.user.role === 'Employee') {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }

    // Toggle: remove if already completed by this user (or if TL toggles off)
    const existingIdx = (taskPlan.completedBy || []).findIndex(
      cb => cb.employee && (cb.employee._id ? cb.employee._id.toString() : cb.employee.toString()) === employeeId.toString()
    );

    let isNowCompleted;
    if (existingIdx !== -1) {
      taskPlan.completedBy.splice(existingIdx, 1);
      isNowCompleted = false;
    } else if (isTeamLead && (taskPlan.completedBy || []).length > 0) {
      taskPlan.completedBy = [];
      isNowCompleted = false;
    } else {
      taskPlan.completedBy.push({
        employee: employeeId,
        completedAt: new Date(),
        note: note.trim()
      });
      isNowCompleted = true;
    }

    await plan.save();

    const updatedPlan = await WeeklyPlan.findById(plan._id)
      .populate('teamLead', 'name email department designation')
      .populate('projectPlans.project', 'title status')
      .populate('projectPlans.assignedEmployees', 'name email department')
      .populate('projectPlans.completedBy.employee', 'name email')
      .populate('adminHrRemarks.user', 'name role');

    // Notify team lead, Admin, and HR that employee marked the task completed
    if (isNowCompleted) {
      const empName = req.user.name || 'An employee';
      const taskMsg = `TASK COMPLETED: ${empName} marked "${taskPlan.projectTitle}" task as completed in plan "${plan.title}"`;

      // 1. Notify Team Lead
      if (plan.teamLead && plan.teamLead.toString() !== req.user._id.toString()) {
        await sendNotification(
          req.app,
          plan.teamLead,
          taskMsg,
          'success',
          `/weekly-plans/${plan._id}`
        );
      }

      // 2. Notify Admin and HR
      await notifyAdminsAndHR(
        req.app,
        taskMsg,
        'success',
        `/weekly-plans/${plan._id}`
      );
    }

    res.json({ plan: updatedPlan, isCompleted: isNowCompleted });
  } catch (error) {
    console.error("Mark Task Complete Error:", error);
    res.status(500).json({ message: 'Server error while updating task completion' });
  }
};

// Delete Weekly Plan
exports.deleteWeeklyPlan = async (req, res) => {
  try {
    const plan = await WeeklyPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Weekly plan not found' });
    }

    const isAdmin = req.user.role === 'Admin';
    const isOwner = plan.teamLead && plan.teamLead.toString() === req.user._id.toString();

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to delete this weekly plan' });
    }

    await WeeklyPlan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Weekly plan removed successfully' });
  } catch (error) {
    console.error("Delete Weekly Plan Error:", error);
    res.status(500).json({ message: 'Server error while deleting weekly plan' });
  }
};
