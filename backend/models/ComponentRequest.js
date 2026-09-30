const mongoose = require('mongoose');

const componentRequestSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  items: [{
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity: { type: Number, required: true, min: 1 }
  }],
  teamLeadId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { 
    type: String, 
    enum: ['Pending TL', 'Approved by TL', 'Rejected by TL', 'Issued', 'Returned'], 
    default: 'Pending TL' 
  },
  tlComments: { type: String },
  issuedAt: { type: Date },
  returnedAt: { type: Date }
}, {
  timestamps: true
});

module.exports = mongoose.model('ComponentRequest', componentRequestSchema);
