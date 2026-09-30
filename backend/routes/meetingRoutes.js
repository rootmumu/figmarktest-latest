const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meetingController');
const { protect, adminHrOrTeamLead, adminOnly } = require('../middleware/authMiddleware');

router.route('/')
  .post(protect, adminHrOrTeamLead, meetingController.createMeeting)
  .get(protect, meetingController.getMeetings);

router.route('/:id')
  .delete(protect, adminOnly, meetingController.deleteMeeting);

router.route('/:id/join')
  .post(protect, meetingController.joinMeeting);

router.route('/:id/end')
  .post(protect, meetingController.endMeeting);

module.exports = router;
