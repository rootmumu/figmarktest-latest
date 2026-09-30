const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  sender: {
    type: String,
    default: 'System'
  },
  type: {
    type: String,
    enum: ['info', 'warning', 'success', 'danger'],
    default: 'info'
  },
  read: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: ''
  },
  action: {
    type: String,
    default: ''
  },
  link: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Notification', notificationSchema);
