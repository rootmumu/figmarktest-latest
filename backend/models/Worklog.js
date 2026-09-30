const mongoose = require('mongoose');

const worklogSchema = new mongoose.Schema({
  employee: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  date: { 
    type: Date, 
    required: true 
  },
  project: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Project',
    default: null 
  },
  description: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['Pending', 'Verified', 'Rejected'], 
    default: 'Pending' 
  },
  verifiedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  teamLeadRemarks: { 
    type: String 
  }
}, { timestamps: true });

module.exports = mongoose.model('Worklog', worklogSchema);
