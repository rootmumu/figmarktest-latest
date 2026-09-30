const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  projectName: { type: String },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String },
  action: { type: String, required: true },
  roleScope: [{ type: String, enum: ['Admin', 'HR', 'TeamLead', 'Employee'] }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
