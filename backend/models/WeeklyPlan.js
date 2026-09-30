const mongoose = require('mongoose');

const projectPlanSubSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project'
  },
  projectTitle: {
    type: String,
    required: true
  },
  tasks: {
    type: String,
    required: true
  },
  assignedEmployees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  deliverables: {
    type: String
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  // Employees who marked this task as completed
  completedBy: [{
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    completedAt: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      default: ''
    }
  }]
}, { _id: true });

const adminRemarkSubSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  name: {
    type: String
  },
  comment: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const weeklyPlanSchema = new mongoose.Schema({
  teamLead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  weekEndDate: {
    type: Date,
    required: true
  },
  department: {
    type: String,
    default: 'General'
  },
  title: {
    type: String,
    required: true
  },
  projectPlans: [projectPlanSubSchema],
  generalObjectives: {
    type: String
  },
  blockersAndDependencies: {
    type: String
  },
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Reviewed'],
    default: 'Submitted'
  },
  adminHrRemarks: [adminRemarkSubSchema],
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  submittedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index to quickly sort by week
weeklyPlanSchema.index({ weekStartDate: -1, teamLead: 1 });

module.exports = mongoose.model('WeeklyPlan', weeklyPlanSchema);
