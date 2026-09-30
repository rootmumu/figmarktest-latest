const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { protect } = require('../middleware/authMiddleware');

router.route('/')
  .get(protect, activityController.getActivityLogs);

module.exports = router;
