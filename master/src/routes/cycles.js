const express = require('express');
const router = express.Router();
const { listCycles, getCycle } = require('../controllers/cyclesController');

router.get('/', listCycles);
router.get('/:cycleId', getCycle);

module.exports = router;
