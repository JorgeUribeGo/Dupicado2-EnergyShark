const express = require('express');
const router = express.Router();
const { listRejected } = require('../controllers/rejectedMessagesController');

router.get('/rejected', listRejected);

module.exports = router;
