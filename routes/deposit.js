const express = require('express');
const {
  createDeposit,
  getUserDeposits,
  getDeposit
} = require('../controllers/depositController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.post('/', createDeposit);
router.get('/', getUserDeposits);
router.get('/:id', getDeposit);

module.exports = router;
