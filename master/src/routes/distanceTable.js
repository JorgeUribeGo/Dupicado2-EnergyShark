const express = require('express');
const router = express.Router();
const { getDistanceTable } = require('../controllers/distanceTableController');

router.get('/', getDistanceTable);

module.exports = router;
