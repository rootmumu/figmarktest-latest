const express = require('express');
const router = express.Router();
const { protect, adminOrHr, adminHrOrTeamLead } = require('../middleware/authMiddleware');
const weeklyPlanController = require('../controllers/weeklyPlanController');

// All weekly plan routes require authentication
router.use(protect);

// Team Leads, Admin, and HR can submit weekly plans
router.post('/', adminHrOrTeamLead, weeklyPlanController.createWeeklyPlan);

// Authenticated users (Team Leads, Employees, Admin, HR) can fetch their relevant weekly plans
router.get('/my', weeklyPlanController.getMyWeeklyPlans);

// Admin and HR can fetch all submitted plans across all departments
router.get('/all', adminOrHr, weeklyPlanController.getAllWeeklyPlans);

// Single weekly plan operations
router.route('/:id')
  .get(weeklyPlanController.getWeeklyPlanById)
  .put(adminHrOrTeamLead, weeklyPlanController.updateWeeklyPlan)
  .delete(adminHrOrTeamLead, weeklyPlanController.deleteWeeklyPlan);

// Employee: toggle task completion status (mark a specific task as done/undone)
router.post('/:planId/tasks/:taskId/complete', weeklyPlanController.markTaskComplete);

module.exports = router;
