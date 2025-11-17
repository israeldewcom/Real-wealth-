const express = require('express');
const {
  getInvestmentPlans,
  getPlanDetails,
  calculateAdvancedReturns
} = require('../controllers/investmentController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Public routes
router.get('/', getInvestmentPlans);
router.get('/:id', getPlanDetails);
router.post('/calculate-advanced', calculateAdvancedReturns);

// Protected routes
router.use(auth);

// Additional protected plan routes can be added here

module.exports = router;
