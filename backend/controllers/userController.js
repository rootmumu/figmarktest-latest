const User = require('../models/User');

// Get all users
exports.getUsers = async (req, res) => {
  try {
    const filters = {};
    if (req.query.role) {
      filters.role = req.query.role; // allow filtering by role e.g. HR, Employee
    }
    if (req.query.status) {
      filters.status = req.query.status;
    }
    if (req.query.activeOnly === 'true') {
      filters.status = { $ne: 'Inactive' };
    }
    const users = await User.find(filters).select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching users' });
  }
};

// Get single user
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching user' });
  }
};

// Create a user (Admin/HR only logically)
exports.createUser = async (req, res) => {
  try {
    const { 
      name, email, password, role, contactNumber, phone, address, employeeId, 
      designation, department, domain, joiningDate, salary, accountNo, ifscCode, branch, status 
    } = req.body;
    
    if (['Accounts', 'Accountant'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Accountant is not authorized to create user accounts' });
    }
    
    if (req.user.role === 'Admin') {
      if (!['HR', 'Accounts', 'Accountant'].includes(role)) {
        return res.status(403).json({ message: 'Admin can only create HR and Accountant accounts.' });
      }
    }
    
    if (req.user.role === 'HR' && ['Admin', 'HR'].includes(role)) {
      return res.status(403).json({ message: 'HR cannot create Admin or HR accounts' });
    }
    if (req.user.role === 'TeamLead' && role !== 'Employee') {
      return res.status(403).json({ message: 'Team Lead can only create Employee accounts' });
    }
    
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    const plainPassword = password || 'password123';
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);
    
    const user = await User.create({
      name, email, password: hashedPassword,
      role, 
      contactNumber, phone, address, employeeId, designation, department, domain, 
      joiningDate, salary, accountNo, ifscCode, branch, status
    });

    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json(userObj);
  } catch (error) {
    res.status(500).json({ message: 'Server error while creating user' });
  }
};

// Update own profile
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isRestricted = ['Employee', 'TeamLead'].includes(user.role);
    const updateData = {};

    if (req.body.image !== undefined) {
      updateData.image = req.body.image;
    }

    if (req.body.password) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(req.body.password, salt);
    }

    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (req.body.phone !== undefined) updateData.phone = req.body.phone;
    if (req.body.contactNumber !== undefined) updateData.contactNumber = req.body.contactNumber;
    if (req.body.address !== undefined) updateData.address = req.body.address;

    if (!isRestricted) {
      if (req.body.email !== undefined) updateData.email = req.body.email;
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updateData, { new: true }).select('-password');
    res.json(updatedUser);
  } catch (error) {
    console.error("Update Profile Error:", error);
    res.status(500).json({ message: 'Server error while updating profile' });
  }
};

// Update user details (Admin/HR/TeamLead only)
exports.updateUser = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.user.role === 'HR') {
      if (['Admin', 'HR'].includes(targetUser.role)) {
        return res.status(403).json({ message: 'HR cannot modify Admin or HR accounts via this route' });
      }
      if (req.body.role && ['Admin', 'HR'].includes(req.body.role)) {
        return res.status(403).json({ message: 'HR cannot elevate roles to Admin or HR' });
      }
    } else if (req.user.role === 'TeamLead') {
      if (targetUser.role !== 'Employee') {
        return res.status(403).json({ message: 'Team Lead can only modify Employee accounts' });
      }
      if (req.body.role && req.body.role !== 'Employee') {
        return res.status(403).json({ message: 'Team Lead cannot assign non-Employee roles' });
      }
    }

    const updateData = { ...req.body };
    if (updateData.password && updateData.password.trim() !== '') {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password, salt);
    } else {
      delete updateData.password;
    }
    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error while updating user' });
  }
};

// Delete user
exports.deleteUser = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (req.user.role === 'HR') {
      if (['Admin', 'HR'].includes(targetUser.role)) {
        return res.status(403).json({ message: 'HR cannot delete Admin or HR accounts' });
      }
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error while deleting user' });
  }
};

// Check if field is unique
exports.checkUnique = async (req, res) => {
  try {
    const { field, value, excludeId } = req.query;
    if (!field || !value) {
      return res.status(400).json({ message: 'Field and value are required' });
    }

    const query = { [field]: value };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingUser = await User.findOne(query);
    res.json({ isUnique: !existingUser });
  } catch (error) {
    res.status(500).json({ message: 'Server error while checking uniqueness' });
  }
};

// Upload bio data for user
exports.uploadBioData = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { compressFile } = require('../utils/compressHelper');
    const compressionData = await compressFile(req.file.path);

    // Save the file path to the user's bioData field
    user.bioData = `uploads/${req.file.filename}`;
    user.bioDataOriginalSize = compressionData.originalSize;
    user.bioDataCompressedSize = compressionData.compressedSize;
    user.bioDataIsCompressed = true;
    await user.save();

    res.json({ 
      message: 'Bio data uploaded successfully', 
      bioData: user.bioData,
      bioDataOriginalSize: user.bioDataOriginalSize,
      bioDataCompressedSize: user.bioDataCompressedSize,
      bioDataIsCompressed: user.bioDataIsCompressed
    });
  } catch (error) {
    console.error("Upload Bio Data Error:", error);
    res.status(500).json({ message: 'Server error while uploading bio data' });
  }
};
