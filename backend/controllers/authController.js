const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOtpEmail } = require('../utils/mailer');

// Generate JWT token
const generateToken = (id, role) => {
  const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_1234';
  return jwt.sign({ id, role }, secret, {
    expiresIn: '30d',
  });
};

/**
 * Register a new user.
 * - Admin registration requires a valid activation key.
 * - All other role registrations are blocked (must be created via invitation).
 */
exports.register = async (req, res) => {
  try {
    const { name, email, password, role, contactNumber, department, activationKey } = req.body;

    // Ensure email is unique
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Role validation
    if (role === 'Admin') {
      // Admin can only be created with a matching activation key
      if (!activationKey || activationKey !== process.env.ADMIN_ACTIVATION_KEY) {
        return res.status(403).json({ message: 'Invalid or missing activation key for Admin registration' });
      }
    } else if (role && role !== 'Employee') {
      // Public registration of any role other than Employee is forbidden
      return res.status(403).json({ message: 'User registration for this role is restricted. Use admin invitation.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
console.log("Incoming register body:", req.body);
    // Create user
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: role || 'Employee',
      contactNumber,
      department,
    });
console.log("Created user:", user);
    // Respond with token and basic info
    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      token: generateToken(user._id, user.role),
    });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// Login remains unchanged
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      if (user.status === 'Inactive') {
        return res.status(403).json({ message: 'Your account has been blocked. Please contact Admin.' });
      }
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        token: generateToken(user._id, user.role),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// Forgot Password - Send OTP
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'Email is not registered' });
    }

    if (user.status === 'Inactive') {
      return res.status(403).json({ message: 'Account is blocked. Cannot reset password.' });
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiry 10 minutes from now
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    user.resetPasswordOtp = otp;
    user.resetPasswordOtpExpiry = expiry;
    user.resetPasswordAttempts = 0; // reset attempts on new OTP
    await user.save();

    await sendOtpEmail(user.email, otp);

    res.json({ message: 'OTP sent to your email successfully' });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    res.status(500).json({ message: 'Error processing forgot password request' });
  }
};

// Verify OTP
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.resetPasswordOtp || !user.resetPasswordOtpExpiry) {
      return res.status(400).json({ message: 'No OTP request found for this email' });
    }

    // Check if expired
    if (new Date() > user.resetPasswordOtpExpiry) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    // Check max attempts (e.g. 5)
    if (user.resetPasswordAttempts >= 5) {
      user.resetPasswordOtp = undefined;
      user.resetPasswordOtpExpiry = undefined;
      await user.save();
      return res.status(429).json({ message: 'Too many invalid attempts. OTP invalidated.' });
    }

    if (user.resetPasswordOtp !== otp.toString()) {
      user.resetPasswordAttempts += 1;
      await user.save();
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // OTP is valid
    res.json({ message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Verify OTP Error:', err);
    res.status(500).json({ message: 'Error verifying OTP' });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const user = await User.findOne({ email });

    if (!user || !user.resetPasswordOtp || !user.resetPasswordOtpExpiry) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    // Double check OTP validity before resetting to prevent bypassing verifyOtp step
    if (new Date() > user.resetPasswordOtpExpiry || user.resetPasswordOtp !== otp.toString() || user.resetPasswordAttempts >= 5) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Invalidate OTP
    user.resetPasswordOtp = undefined;
    user.resetPasswordOtpExpiry = undefined;
    user.resetPasswordAttempts = 0;
    
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ message: 'Error resetting password' });
  }
};
