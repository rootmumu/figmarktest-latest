const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, chatController.handleChatMessage);

module.exports = router;
