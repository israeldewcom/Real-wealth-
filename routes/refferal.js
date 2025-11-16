const express = require('express');
const {
  getReferralStats,
  getReferralList,
  processReferralBonus
} = require('../controllers/referralController');
const { auth, admin } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/stats', getReferralStats);
router.get('/list', getReferralList);
router.post('/process-bonus', admin, processReferralBonus);

module.exports = router;
