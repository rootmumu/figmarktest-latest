const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const secret = process.env.JWT_SECRET || 'super_secret_jwt_key_1234';
      const decoded = jwt.verify(token, secret);

      // Get user from the token
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const adminOrHr = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an Admin or HR' });
  }
};

const adminHrOrTeamLead = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR' || req.user.role === 'TeamLead')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized for this level of modification' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'Admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Admin only' });
  }
};

const adminHrOrAccounts = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR' || req.user.role === 'Accounts')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Admin, HR or Accounts only' });
  }
};

const adminOrAccounts = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'Accounts')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized: Only Admin and Accounts can manage payments' });
  }
};


const adminHrTeamLeadOrAccounts = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR' || req.user.role === 'TeamLead' || req.user.role === 'Accounts')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Admin, HR, TeamLead or Accounts only' });
  }
};

const bugIssueAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  const role = req.user.role;
  const dept = (req.user.department || '').toLowerCase();

  if (['Admin', 'HR'].includes(role)) {
    return next();
  }

  if (['Employee', 'TeamLead'].includes(role)) {
    if (dept.includes('software') || dept.includes('electronics') || dept.includes('ai')) {
      return next();
    }
  }

  return res.status(403).json({ message: 'Access Denied: You are not authorized to use the Bug/Issue trackers.' });
};

module.exports = { protect, adminOrHr, adminHrOrTeamLead, adminOnly, adminHrOrAccounts, adminOrAccounts, adminHrTeamLeadOrAccounts, bugIssueAccess };
