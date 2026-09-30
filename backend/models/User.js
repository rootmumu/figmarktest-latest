const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['Admin', 'HR', 'TeamLead', 'Employee', 'Accounts'],
    default: 'Employee'
  },
  contactNumber: { type: String },
  phone: { type: String },
  address: { type: String },
  image: { type: String },
  bioData: { type: String },
  bioDataOriginalSize: { type: String },
  bioDataCompressedSize: { type: String },
  bioDataIsCompressed: { type: Boolean, default: false },
  employeeId: { type: String },
  designation: { type: String },
  department: { type: String },
  domain: { type: String },
  joiningDate: { type: Date },
  salary: { type: Number },
  accountNo: { type: String },
  ifscCode: { type: String },
  branch: { type: String },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  resetPasswordOtp: { type: String },
  resetPasswordOtpExpiry: { type: Date },
  resetPasswordAttempts: { type: Number, default: 0 }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
