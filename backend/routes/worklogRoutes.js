const express = require('express');
const router = express.Router();
const { protect, adminOrHr, adminHrOrTeamLead } = require('../middleware/authMiddleware');
const {
  submitWorklog,
  getMyWorklogs,
  getTeamWorklogs,
  getAllWorklogs,
  exportWorklogs,
  updateWorklog,
  verifyWorklog,
  deleteWorklog
} = require('../controllers/worklogController');

// All routes require authentication
router.use(protect);

// Employee routes
router.post('/', submitWorklog);
router.get('/me', getMyWorklogs);

// Team Lead routes
// NOTE: adminHrOrTeamLead middleware allows TeamLeads, Admins, and HRs to access this
router.get('/team', adminHrOrTeamLead, getTeamWorklogs);
router.put('/:id', adminHrOrTeamLead, updateWorklog);
router.put('/:id/verify', adminHrOrTeamLead, verifyWorklog);
router.delete('/:id', adminHrOrTeamLead, deleteWorklog);

// HR/Admin routes
router.get('/all', adminOrHr, getAllWorklogs);
router.get('/export', adminOrHr, exportWorklogs);

module.exports = router;

