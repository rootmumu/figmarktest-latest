const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { protect, adminOrHr, adminHrOrTeamLead, adminOnly } = require('../middleware/authMiddleware');

const multer = require('multer');

const path = require('path');
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
  .get(protect, userController.getUsers)
  .post(protect, adminHrOrTeamLead, userController.createUser);

router.route('/profile')
  .put(protect, userController.updateProfile);

router.route('/check-unique')
  .get(protect, adminHrOrTeamLead, userController.checkUnique);

router.route('/:id')
  .get(protect, userController.getUserById)
  .put(protect, adminHrOrTeamLead, userController.updateUser)
  .delete(protect, adminOrHr, userController.deleteUser);

router.route('/:id/biodata')
  .post(protect, adminHrOrTeamLead, upload.single('bioData'), userController.uploadBioData);

module.exports = router;
