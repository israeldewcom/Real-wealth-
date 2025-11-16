const express = require('express');
const {
  enable2FA,
  verify2FA,
  disable2FA,
  verifyLogin2FA
} = require('../controllers/twoFactorController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.use('/enable', auth);
router.use('/verify', auth);
router.use('/disable', auth);

router.post('/enable', enable2FA);
router.post('/verify', verify2FA);
router.post('/disable', disable2FA);
router.post('/verify-login', verifyLogin2FA);

module.exports = router;
