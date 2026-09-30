const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, enum: ['academic', 'client', 'product'], required: true },
  domain: { type: String },
  department: { type: String, default: 'Software Dept' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  status: { type: String, enum: ['pending', 'in-progress', 'completed', 'cancelled'], default: 'pending' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  startDate: { type: Date },
  deadline: { type: Date },
  teamLead: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  teamLeads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  totalCost: { type: Number },
  emiPlan: { type: Number, default: 1 },
  initialAmount: { type: Number, default: 0 },
  description: { type: String },
  websiteUrl: { type: String },
  
  // Specific to Academic projects
  college: { type: String },
  dept: { type: String },
  branch: { type: String },
  semester: { type: String },
  assignedMembers: [{
    name: String,
    contact: String,
    email: String
  }],

  // Specific to Client projects
  clientName: { type: String },
  clientEmail: { type: String },
  clientContact: { type: String },

  // Assigned Employees
  assignedEmployees: [{
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: String,
    contact: String,
    phone: String,
    status: { type: String, default: 'Active' },
    areaOfWork: String
  }],

  // Employee Assignment Approval Requests (for Completed Project Protection)
  employeeApprovalRequests: [{
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: String,
    contact: String,
    phone: String,
    action: { type: String, enum: ['assign', 'remove'] },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedBy: String,
    createdAt: { type: Date, default: Date.now }
  }],

  // Sub-documents for project tracking
  issues: [{
    title: String,
    details: String,
    priority: String,
    status: { type: String, default: "Open" },
    type: { type: String, enum: ['Bug', 'Issue'], default: 'Issue' },
    reportedBy: String,
    createdAt: { type: Date, default: Date.now }
  }],
  timeline: [{
    message: String,
    author: String,
    date: { type: Date, default: Date.now }
  }],
  payments: [{
    amount: Number,
    date: Date,
    mode: String,
    status: { type: String, default: "Paid" },
    studentName: String,
    collegeName: String
  }],
  initialPaymentDate: { type: Date },
  emiSchedule: [{
    dueDate: Date,
    amount: Number,
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Pending' }
  }],
  documents: [{
    name: String,
    url: String, 
    size: String,
    uploadedBy: String,
    isCompressed: { type: Boolean, default: false },
    originalSize: String,
    compressedSize: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  inventory: [{
    name: String,
    quantity: Number,
    lastUpdated: { type: Date, default: Date.now }
  }],
  hardwareRequests: [{
    name: String,
    quantity: Number,
    reason: String,
    requestedBy: String,
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Project', projectSchema);
