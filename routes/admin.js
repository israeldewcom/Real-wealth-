const express = require('express');
const {
  getDashboardStats,
  getPendingDeposits,
  approveDeposit,
  rejectDeposit,
  getPendingWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getPendingInvestments,
  approveInvestment,
  rejectInvestment,
  getAllUsers,
  getUserDetails,
  updateUserStatus,
  getPlatformAnalytics
} = require('../controllers/adminController');
const { auth, admin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(auth);
router.use(admin);

// Dashboard
router.get('/dashboard', getDashboardStats);
router.get('/analytics', getPlatformAnalytics);

// Deposits management
router.get('/pending-deposits', getPendingDeposits);
router.post('/approve-deposit', approveDeposit);
router.post('/reject-deposit', rejectDeposit);

// Withdrawals management
router.get('/pending-withdrawals', getPendingWithdrawals);
router.post('/approve-withdrawal', approveWithdrawal);
router.post('/reject-withdrawal', rejectWithdrawal);

// Investments management
router.get('/pending-investments', getPendingInvestments);
router.post('/approve-investment', approveInvestment);
router.post('/reject-investment', rejectInvestment);

// Users management
router.get('/users', getAllUsers);
router.get('/users/:id', getUserDetails);
router.put('/users/:id/status', updateUserStatus);

module.exports = router;
