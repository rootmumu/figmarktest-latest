const ActivityLog = require('../models/ActivityLog');
const Project = require('../models/Project');

exports.getActivityLogs = async (req, res) => {
  try {
    const role = req.user.role;
    let filter = {};

    if (role === 'TeamLead' || (role || '').toLowerCase() === 'teamlead') {
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
      const projects = await Project.find({ $or: orConditions }).select('_id');
      const projectIds = projects.map(p => p._id);
      filter = { projectId: { $in: projectIds } };
    } else if (role === 'Employee' || (role || '').toLowerCase() === 'employee') {
      const userEmail = (req.user.email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const userName = (req.user.name || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const orConditions = [
        { 'assignedEmployees.employeeId': req.user._id }
      ];
      if (userEmail) {
        orConditions.push({ 'assignedEmployees.contact': { $regex: new RegExp(`^${userEmail}$`, 'i') } });
      }
      if (userName) {
        orConditions.push({ 'assignedEmployees.name': { $regex: new RegExp(`^${userName}$`, 'i') } });
      }
      const projects = await Project.find({ $or: orConditions }).select('_id');
      const projectIds = projects.map(p => p._id);
      filter = { projectId: { $in: projectIds } };
    }

    const logs = await ActivityLog.find(filter)
      .populate('projectId', 'title')
      .populate('user', 'name role')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json(logs);
  } catch (error) {
    console.error("Get Activity Logs Error:", error);
    res.status(500).json({ message: 'Server error while fetching activities' });
  }
};
