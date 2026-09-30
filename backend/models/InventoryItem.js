const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  category: { 
    type: String, 
    required: true, 
    enum: ['ICs', 'Microcontrollers', 'Diodes', 'Sensors', 'Passives', 'Tools', 'Others'] 
  },
  totalQuantity: { type: Number, required: true, min: 0 },
  availableQuantity: { type: Number, required: true, min: 0 },
  defectiveQuantity: { type: Number, default: 0, min: 0 },
  unitCost: { type: Number, required: true, min: 0 },
  minThreshold: { type: Number, default: 5 },
  location: { type: String },
  description: { type: String }
}, {
  timestamps: true
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
