const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public (in production, might be restricted to Admin/HR)
router.post('/register', authController.register);

// @route   POST /api/auth/login
// @desc    Login user & get token
// @access  Public
router.post('/login', authController.login);

// @route   POST /api/auth/forgot-password
// @desc    Send OTP to email
// @access  Public
router.post('/forgot-password', authController.forgotPassword);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP
// @access  Public
router.post('/verify-otp', authController.verifyOtp);

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', authController.resetPassword);

module.exports = router;
