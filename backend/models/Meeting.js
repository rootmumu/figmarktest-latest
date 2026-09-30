const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  scheduledTime: {
    type: Date,
    required: true,
  },
  attendees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  status: {
    type: String,
    enum: ['Scheduled', 'InProgress', 'Completed'],
    default: 'Scheduled'
  },
  startTime: {
    type: Date
  },
  endTime: {
    type: Date
  },
  actualDuration: {
    type: Number // stored in milliseconds
  },
  roomName: {
    type: String,
    required: true,
    unique: true,
  },
  scheduledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Meeting', meetingSchema);
