const mongoose = require('mongoose');

// PurchaseRecord — records an actual offline purchase made by an employee
// Accountant records this after receiving the invoice/bill.
// On save: inventory is automatically incremented or a new item is created.
const purchaseOrderSchema = new mongoose.Schema({
  // The linked inventory item (set after save or creation)
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' },

  // Component details (used when creating a new item)
  componentName:   { type: String, required: true },
  category: {
    type: String,
    required: true,
    enum: ['ICs', 'Microcontrollers', 'Diodes', 'Sensors', 'Passives', 'Tools', 'Others'],
    default: 'Others'
  },
  storageLocation: { type: String },

  // Purchase details
  purchaseDate:        { type: Date, required: true },
  quantityPurchased:   { type: Number, required: true, min: 1 },
  unitCost:            { type: Number, required: true, min: 0 },
  totalCost:           { type: Number, required: true, min: 0 },

  // People involved
  approvedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // HR/Admin
  purchasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Employee who bought
  recordedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Accountant

  // Optional fields
  supplierName:  { type: String },
  invoiceNumber: { type: String },
  remarks:       { type: String },

  // Always 'Completed' — a purchase record is final once saved
  status: {
    type: String,
    enum: ['Completed'],
    default: 'Completed'
  },

  // Used to unify with allocation records in the Accounts Log
  transactionType: {
    type: String,
    enum: ['Purchase'],
    default: 'Purchase'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
