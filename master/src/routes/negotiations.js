const express = require('express');
const router = express.Router();
const { createNegotiation, listNegotiations, getNegotiation } = require('../controllers/negotiationsController');

router.get('/', listNegotiations);
router.post('/', createNegotiation);
router.get('/:id', getNegotiation);

module.exports = router;
