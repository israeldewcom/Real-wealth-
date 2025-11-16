const User = require('../models/User');
const Investment = require('../models/Investment');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const KYC = require('../models/KYC');
const SupportTicket = require('../models/SupportTicket');
const logger = require('../utils/logger');

// @desc    Get admin dashboard stats
// @route   GET /api/admin/dashboard
// @access  Private/Admin
exports.getDashboardStats = async (req, res) => {
  try {
    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ is_active: true });
    const verifiedUsers = await User.countDocuments({ kyc_verified: true });
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
    });

    // Investment statistics
    const totalInvested = await Investment.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const pendingInvestments = await Investment.countDocuments({ status: 'pending' });
    const activeInvestments = await Investment.countDocuments({ status: 'active' });

    // Transaction statistics
    const totalDeposits = await Deposit.aggregate([
      { $match: { status: 'approved' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalWithdrawals = await Withdrawal.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalFees = await Withdrawal.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$fee' } } }
    ]);

    // Pending requests
    const pendingDeposits = await Deposit.countDocuments({ status: 'pending' });
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
    const pendingKYC = await KYC.countDocuments({ status: 'pending' });
    const openTickets = await SupportTicket.countDocuments({ status: 'open' });

    const stats = {
      users: {
        total: totalUsers,
        active: activeUsers,
        verified: verifiedUsers,
        new_today: newUsersToday
      },
      investments: {
        total_amount: totalInvested[0]?.total || 0,
        pending: pendingInvestments,
        active: activeInvestments
      },
      transactions: {
        total_deposits: totalDeposits[0]?.total || 0,
        total_withdrawals: totalWithdrawals[0]?.total || 0,
        total_fees: totalFees[0]?.total || 0
      },
      pending_requests: {
        deposits: pendingDeposits,
        withdrawals: pendingWithdrawals,
        kyc: pendingKYC,
        support_tickets: openTickets
      }
    };

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    logger.error('Get admin dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard stats'
    });
  }
};

// @desc    Get pending deposits
// @route   GET /api/admin/pending-deposits
// @access  Private/Admin
exports.getPendingDeposits = async (req, res) => {
  try {
    const deposits = await Deposit.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { deposits }
    });
  } catch (error) {
    logger.error('Get pending deposits error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending deposits'
    });
  }
};

// @desc    Approve deposit
// @route   POST /api/admin/approve-deposit
// @access  Private/Admin
exports.approveDeposit = async (req, res) => {
  try {
    const { deposit_id } = req.body;

    const deposit = await Deposit.findById(deposit_id).populate('user');
    if (!deposit) {
      return res.status(404).json({
        success: false,
        message: 'Deposit not found'
      });
    }

    if (deposit.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Deposit already processed'
      });
    }

    // Update deposit status
    deposit.status = 'approved';
    deposit.approved_by = req.user.id;
    deposit.approved_at = new Date();
    await deposit.save();

    // Update user balance
    await User.findByIdAndUpdate(deposit.user._id, {
      $inc: { balance: deposit.amount }
    });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.deposit_id': deposit_id },
      { status: 'completed' }
    );

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${deposit.user._id}`).emit('deposit-approved', {
      message: `Your deposit of ₦${deposit.amount.toLocaleString()} has been approved`,
      amount: deposit.amount,
      newBalance: deposit.user.balance + deposit.amount
    });

    res.json({
      success: true,
      message: 'Deposit approved successfully',
      data: { deposit }
    });

  } catch (error) {
    logger.error('Approve deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving deposit'
    });
  }
};

// @desc    Get pending withdrawals
// @route   GET /api/admin/pending-withdrawals
// @access  Private/Admin
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { withdrawals }
    });
  } catch (error) {
    logger.error('Get pending withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending withdrawals'
    });
  }
};

// @desc    Approve withdrawal
// @route   POST /api/admin/approve-withdrawal
// @access  Private/Admin
exports.approveWithdrawal = async (req, res) => {
  try {
    const { withdrawal_id } = req.body;

    const withdrawal = await Withdrawal.findById(withdrawal_id).populate('user');
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal already processed'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'approved';
    withdrawal.approved_by = req.user.id;
    withdrawal.approved_at = new Date();
    await withdrawal.save();

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.withdrawal_id': withdrawal_id },
      { status: 'completed' }
    );

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${withdrawal.user._id}`).emit('withdrawal-approved', {
      message: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been approved and is being processed`,
      amount: withdrawal.amount,
      netAmount: withdrawal.net_amount
    });

    res.json({
      success: true,
      message: 'Withdrawal approved successfully',
      data: { withdrawal }
    });

  } catch (error) {
    logger.error('Approve withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving withdrawal'
    });
  }
};

// @desc    Get pending investments
// @route   GET /api/admin/pending-investments
// @access  Private/Admin
exports.getPendingInvestments = async (req, res) => {
  try {
    const investments = await Investment.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .populate('plan')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: { investments }
    });
  } catch (error) {
    logger.error('Get pending investments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending investments'
    });
  }
};

// @desc    Approve investment
// @route   POST /api/admin/approve-investment
// @access  Private/Admin
exports.approveInvestment = async (req, res) => {
  try {
    const { investment_id } = req.body;

    const investment = await Investment.findById(investment_id)
      .populate('user')
      .populate('plan');

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    if (investment.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Investment already processed'
      });
    }

    // Check user balance
    if (investment.user.balance < investment.amount) {
      return res.status(400).json({
        success: false,
        message: 'User has insufficient balance for this investment'
      });
    }

    // Update investment status and set end date
    investment.status = 'active';
    investment.start_date = new Date();
    investment.end_date = new Date(Date.now() + investment.plan.duration * 24 * 60 * 60 * 1000);
    await investment.save();

    // Deduct from user balance
    await User.findByIdAndUpdate(investment.user._id, {
      $inc: { balance: -investment.amount }
    });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.investment_id': investment_id },
      { status: 'completed' }
    );

    // Process referral bonus if applicable
    if (investment.user.referred_by) {
      // This would call the referral bonus processing
      // For now, we'll just log it
      logger.info(`Referral bonus eligible for user: ${investment.user.referred_by}`);
    }

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${investment.user._id}`).emit('investment-approved', {
      message: `Your investment in ${investment.plan.name} has been approved`,
      investmentId: investment._id,
      planName: investment.plan.name,
      amount: investment.amount,
      duration: investment.plan.duration
    });

    res.json({
      success: true,
      message: 'Investment approved successfully',
      data: { investment }
    });

  } catch (error) {
    logger.error('Approve investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving investment'
    });
  }
};
