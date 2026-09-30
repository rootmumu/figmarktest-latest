const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { protect, adminOrHr, adminHrOrTeamLead, adminOnly, adminHrOrAccounts, adminOrAccounts, adminHrTeamLeadOrAccounts, bugIssueAccess } = require('../middleware/authMiddleware');

const multer = require('multer');

const path = require('path');
// Configure Multer for local documents upload
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

router.route('/')
  .post(protect, adminOrHr, projectController.createProject)
  .get(protect, projectController.getProjects);

router.route('/check-unique')
  .get(protect, adminHrOrTeamLead, projectController.checkUnique);

router.route('/:id')
  .get(protect, projectController.getProjectById)
  .put(protect, projectController.updateProject)
  .delete(protect, adminOrHr, projectController.deleteProject);

// Nested routes for tracking entities
router.post('/:id/issues', protect, bugIssueAccess, projectController.addIssue);
router.put('/:id/issues/:issueId', protect, bugIssueAccess, adminHrOrTeamLead, projectController.resolveIssue);
router.delete('/:id/issues/:issueId', protect, bugIssueAccess, adminOnly, projectController.deleteIssue);
router.put('/:id/issues/:issueId/escalate', protect, bugIssueAccess, adminHrOrTeamLead, projectController.escalateIssue);
router.post('/:id/issues/:issueId/nudge', protect, bugIssueAccess, adminOrHr, projectController.nudgeIssue);
router.post('/:id/payments', protect, adminOrAccounts, projectController.addPayment);
router.post('/:id/timeline', protect, projectController.addTimelineLog);
router.post('/:id/documents', protect, upload.single('document'), projectController.uploadDocument);
router.delete('/:id/documents/:docId', protect, adminHrTeamLeadOrAccounts, projectController.deleteDocument);
router.post('/:id/hardware', protect, projectController.requestHardware);
router.put('/:id/hardware/:reqId/approve', protect, projectController.approveHardware);
router.put('/:id/hardware/:reqId/reject', protect, projectController.rejectHardware);

// Employee assignment approval requests on completed projects
router.put('/:id/employee-requests/:reqId/approve', protect, adminOrHr, projectController.approveEmployeeRequest);
router.put('/:id/employee-requests/:reqId/reject', protect, adminOrHr, projectController.rejectEmployeeRequest);

module.exports = router;
