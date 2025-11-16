const express = require('express');
const {
  submitKYC,
  getKYCStatus,
  getKYCApplications,
  updateKYCStatus
} = require('../controllers/kycController');
const { auth, admin } = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.post('/', submitKYC);
router.get('/status', getKYCStatus);

// Admin routes
router.get('/admin/applications', admin, getKYCApplications);
router.put('/admin/:id/status', admin, updateKYCStatus);

module.exports = router;
