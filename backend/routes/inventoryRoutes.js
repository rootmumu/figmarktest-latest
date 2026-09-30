const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
  getItems,
  createItem,
  updateItem,
  deleteItem,
  createRequest,
  getRequests,
  reviewRequest,
  createPurchaseOrder,
  getPurchaseOrders,
  approvePurchaseOrder,
  receivePurchaseOrder,
  getFinancials,
  createPurchaseRecord,
  getPurchaseRecords
} = require('../controllers/inventoryController');

// Role helpers
const accountsOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'Accounts' || req.user.role === 'Admin')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Accounts or Admin only' });
  }
};

const adminOrHr = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Admin or HR only' });
  }
};

const adminHrOrAccounts = (req, res, next) => {
  if (req.user && (req.user.role === 'Admin' || req.user.role === 'HR' || req.user.role === 'Accounts')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, Admin, HR or Accounts only' });
  }
};

const tlOrAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'TeamLead' || req.user.role === 'Admin' || req.user.role === 'HR')) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized, TeamLead, HR or Admin only' });
  }
};

const inventoryAccess = (req, res, next) => {
  if (req.user) {
    if (['Admin', 'HR', 'Accounts'].includes(req.user.role)) {
      return next();
    }
    const dept = (req.user.department || '').toLowerCase();
    if (['TeamLead', 'Employee'].includes(req.user.role) && (dept.includes('electronics') || dept.includes('embedded') || dept.includes('hardware'))) {
      return next();
    }
  }
  res.status(403).json({ message: 'Not authorized to access Inventory' });
};

router.use(protect);
router.use(inventoryAccess);

// Item Routes
router.route('/')
  .get(getItems)
  .post(accountsOrAdmin, createItem);

router.route('/:id')
  .put(accountsOrAdmin, updateItem)
  .delete(accountsOrAdmin, deleteItem);

// Request Routes
router.route('/requests')
  .get(getRequests)
  .post(createRequest);

router.route('/requests/:id/review')
  .put(tlOrAdmin, reviewRequest);

// Purchase Order Routes
router.route('/purchase-orders')
  .get(getPurchaseOrders)
  .post(adminHrOrAccounts, createPurchaseOrder);

router.route('/purchase-orders/:id/approve')
  .put(accountsOrAdmin, approvePurchaseOrder);

router.route('/purchase-orders/:id/receive')
  .put(adminHrOrAccounts, receivePurchaseOrder);

// Financial Reports Route
router.route('/reports/financials')
  .get(accountsOrAdmin, getFinancials);

// Purchase Records Route (Accountant records completed offline purchases)
router.route('/purchases')
  .get(adminHrOrAccounts, getPurchaseRecords)
  .post(accountsOrAdmin, createPurchaseRecord);

module.exports = router;
