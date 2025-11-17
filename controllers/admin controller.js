const User = require('../models/User');
const Investment = require('../models/Investment');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const KYC = require('../models/KYC');
const SupportTicket = require('../models/SupportTicket');
const InvestmentPlan = require('../models/InvestmentPlan');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/emailService');

/**
 * @desc    Get admin dashboard statistics
 * @route   GET /api/admin/dashboard
 * @access  Private/Admin
 */
exports.getDashboardStats = async (req, res) => {
  try {
    // Current date calculations
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const todayEnd = new Date(now.setHours(23, 59, 59, 999));
    const weekStart = new Date(now.setDate(now.getDate() - 7));
    const monthStart = new Date(now.setMonth(now.getMonth() - 1));

    // User statistics
    const userStats = await User.aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          today: [{ $match: { created_at: { $gte: todayStart } } }, { $count: 'count' }],
          thisWeek: [{ $match: { created_at: { $gte: weekStart } } }, { $count: 'count' }],
          thisMonth: [{ $match: { created_at: { $gte: monthStart } } }, { $count: 'count' }],
          verified: [{ $match: { kyc_verified: true } }, { $count: 'count' }],
          active: [{ $match: { is_active: true } }, { $count: 'count' }],
          byRisk: [
            { $group: { _id: '$risk_tolerance', count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    // Investment statistics
    const investmentStats = await Investment.aggregate([
      {
        $facet: {
          total: [{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
          active: [{ $match: { status: 'active' } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
          pending: [{ $match: { status: 'pending' } }, { $count: 'count' }],
          today: [{ $match: { created_at: { $gte: todayStart } } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
          byPlan: [
            { $group: { _id: '$plan', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          byStatus: [
            { $group: { _id: '$status', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    // Transaction statistics
    const transactionStats = await Transaction.aggregate([
      {
        $facet: {
          deposits: [
            { $match: { type: 'deposit', status: 'completed' } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          withdrawals: [
            { $match: { type: 'withdrawal', status: 'completed' } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          earnings: [
            { $match: { type: 'investment_earnings', status: 'completed' } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ],
          today: [
            { $match: { created_at: { $gte: todayStart } } },
            { $group: { _id: '$type', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
          ]
        }
    ]);

    // Platform revenue (fees)
    const revenueStats = await Withdrawal.aggregate([
      {
        $match: { status: 'completed' }
      },
      {
        $group: {
          _id: null,
          totalFees: { $sum: '$fee' },
          totalWithdrawals: { $sum: '$net_amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Pending requests
    const pendingRequests = await Promise.all([
      Deposit.countDocuments({ status: 'pending' }),
      Withdrawal.countDocuments({ status: 'pending' }),
      Investment.countDocuments({ status: 'pending' }),
      KYC.countDocuments({ status: 'pending' }),
      SupportTicket.countDocuments({ status: 'open' })
    ]);

    const stats = {
      users: {
        total: userStats[0]?.total[0]?.count || 0,
        today: userStats[0]?.today[0]?.count || 0,
        thisWeek: userStats[0]?.thisWeek[0]?.count || 0,
        thisMonth: userStats[0]?.thisMonth[0]?.count || 0,
        verified: userStats[0]?.verified[0]?.count || 0,
        active: userStats[0]?.active[0]?.count || 0,
        riskDistribution: userStats[0]?.byRisk || []
      },
      investments: {
        totalAmount: investmentStats[0]?.total[0]?.amount || 0,
        totalCount: investmentStats[0]?.total[0]?.count || 0,
        activeAmount: investmentStats[0]?.active[0]?.amount || 0,
        activeCount: investmentStats[0]?.active[0]?.count || 0,
        pendingCount: investmentStats[0]?.pending[0]?.count || 0,
        todayAmount: investmentStats[0]?.today[0]?.amount || 0,
        todayCount: investmentStats[0]?.today[0]?.count || 0,
        byPlan: investmentStats[0]?.byPlan || [],
        byStatus: investmentStats[0]?.byStatus || []
      },
      transactions: {
        totalDeposits: transactionStats[0]?.deposits[0]?.amount || 0,
        depositCount: transactionStats[0]?.deposits[0]?.count || 0,
        totalWithdrawals: Math.abs(transactionStats[0]?.withdrawals[0]?.amount) || 0,
        withdrawalCount: transactionStats[0]?.withdrawals[0]?.count || 0,
        totalEarnings: transactionStats[0]?.earnings[0]?.amount || 0,
        earningsCount: transactionStats[0]?.earnings[0]?.count || 0,
        todayTransactions: transactionStats[0]?.today || []
      },
      revenue: {
        totalFees: revenueStats[0]?.totalFees || 0,
        totalWithdrawals: revenueStats[0]?.totalWithdrawals || 0,
        withdrawalCount: revenueStats[0]?.count || 0
      },
      pending: {
        deposits: pendingRequests[0],
        withdrawals: pendingRequests[1],
        investments: pendingRequests[2],
        kyc: pendingRequests[3],
        supportTickets: pendingRequests[4]
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

/**
 * @desc    Get pending deposits for admin
 * @route   GET /api/admin/pending-deposits
 * @access  Private/Admin
 */
exports.getPendingDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const deposits = await Deposit.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Deposit.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        deposits,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get pending deposits error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending deposits'
    });
  }
};

/**
 * @desc    Approve deposit (Admin)
 * @route   POST /api/admin/approve-deposit
 * @access  Private/Admin
 */
exports.approveDeposit = async (req, res) => {
  const session = await Deposit.startSession();
  session.startTransaction();

  try {
    const { deposit_id, admin_notes } = req.body;

    const deposit = await Deposit.findById(deposit_id)
      .populate('user')
      .session(session);

    if (!deposit) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Deposit not found'
      });
    }

    if (deposit.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Deposit already processed'
      });
    }

    // Update deposit status
    deposit.status = 'approved';
    deposit.approved_by = req.user.id;
    deposit.approved_at = new Date();
    deposit.admin_notes = admin_notes;
    await deposit.save({ session });

    // Update user balance
    const user = await User.findById(deposit.user._id).session(session);
    user.balance += deposit.amount;
    await user.save({ session });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.deposit_id': deposit_id },
      { 
        status: 'completed',
        description: `Deposit approved - ${deposit.payment_method}`
      },
      { session }
    );

    // Create balance update transaction
    await Transaction.create([{
      user: deposit.user._id,
      type: 'deposit',
      amount: deposit.amount,
      description: `Deposit via ${deposit.payment_method}`,
      status: 'completed',
      metadata: {
        deposit_id: deposit._id,
        payment_method: deposit.payment_method,
        approved_by: req.user.id
      }
    }], { session });

    await session.commitTransaction();

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${deposit.user._id}`).emit('deposit-approved', {
      message: `Your deposit of ₦${deposit.amount.toLocaleString()} has been approved`,
      amount: deposit.amount,
      newBalance: user.balance,
      depositId: deposit._id
    });

    // Send approval email
    try {
      await sendEmail({
        email: deposit.user.email,
        subject: 'Deposit Approved - Raw Wealthy',
        template: 'deposit-approved',
        data: {
          name: deposit.user.full_name,
          amount: deposit.amount,
          newBalance: user.balance,
          timestamp: new Date().toLocaleString()
        }
      });
    } catch (emailError) {
      logger.error('Deposit approval email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Deposit approved successfully',
      data: { deposit }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Approve deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving deposit'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject deposit (Admin)
 * @route   POST /api/admin/reject-deposit
 * @access  Private/Admin
 */
exports.rejectDeposit = async (req, res) => {
  try {
    const { deposit_id, rejection_reason } = req.body;

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

    deposit.status = 'rejected';
    deposit.rejection_reason = rejection_reason;
    deposit.updated_at = new Date();
    await deposit.save();

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.deposit_id': deposit_id },
      { 
        status: 'failed',
        description: `Deposit rejected: ${rejection_reason}`
      }
    );

    // Notify user
    const io = req.app.get('io');
    io.to(`user-${deposit.user._id}`).emit('deposit-rejected', {
      message: `Your deposit of ₦${deposit.amount.toLocaleString()} was rejected`,
      amount: deposit.amount,
      reason: rejection_reason,
      depositId: deposit._id
    });

    res.json({
      success: true,
      message: 'Deposit rejected successfully',
      data: { deposit }
    });

  } catch (error) {
    logger.error('Reject deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while rejecting deposit'
    });
  }
};

/**
 * @desc    Get pending withdrawals for admin
 * @route   GET /api/admin/pending-withdrawals
 * @access  Private/Admin
 */
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const withdrawals = await Withdrawal.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Withdrawal.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        withdrawals,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get pending withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending withdrawals'
    });
  }
};

/**
 * @desc    Approve withdrawal (Admin)
 * @route   POST /api/admin/approve-withdrawal
 * @access  Private/Admin
 */
exports.approveWithdrawal = async (req, res) => {
  const session = await Withdrawal.startSession();
  session.startTransaction();

  try {
    const { withdrawal_id, admin_notes, transaction_hash } = req.body;

    const withdrawal = await Withdrawal.findById(withdrawal_id)
      .populate('user')
      .session(session);

    if (!withdrawal) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Withdrawal already processed'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'approved';
    withdrawal.approved_by = req.user.id;
    withdrawal.approved_at = new Date();
    withdrawal.admin_notes = admin_notes;
    withdrawal.transaction_hash = transaction_hash;
    await withdrawal.save({ session });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.withdrawal_id': withdrawal_id },
      { 
        status: 'completed',
        description: `Withdrawal approved - ${withdrawal.payment_method}`
      },
      { session }
    );

    await session.commitTransaction();

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${withdrawal.user._id}`).emit('withdrawal-approved', {
      message: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been approved and is being processed`,
      amount: withdrawal.amount,
      netAmount: withdrawal.net_amount,
      fee: withdrawal.fee,
      withdrawalId: withdrawal._id,
      transactionHash: transaction_hash
    });

    // Send approval email
    try {
      await sendEmail({
        email: withdrawal.user.email,
        subject: 'Withdrawal Approved - Raw Wealthy',
        template: 'withdrawal-approved',
        data: {
          name: withdrawal.user.full_name,
          amount: withdrawal.amount,
          netAmount: withdrawal.net_amount,
          fee: withdrawal.fee,
          paymentMethod: withdrawal.payment_method,
          transactionHash: transaction_hash,
          timestamp: new Date().toLocaleString()
        }
      });
    } catch (emailError) {
      logger.error('Withdrawal approval email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Withdrawal approved successfully',
      data: { withdrawal }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Approve withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving withdrawal'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject withdrawal (Admin)
 * @route   POST /api/admin/reject-withdrawal
 * @access  Private/Admin
 */
exports.rejectWithdrawal = async (req, res) => {
  const session = await Withdrawal.startSession();
  session.startTransaction();

  try {
    const { withdrawal_id, rejection_reason } = req.body;

    const withdrawal = await Withdrawal.findById(withdrawal_id)
      .populate('user')
      .session(session);

    if (!withdrawal) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found'
      });
    }

    if (withdrawal.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Withdrawal already processed'
      });
    }

    // Update withdrawal status
    withdrawal.status = 'rejected';
    withdrawal.rejection_reason = rejection_reason;
    withdrawal.updated_at = new Date();
    await withdrawal.save({ session });

    // Refund amount to user balance (since it was deducted on creation)
    const user = await User.findById(withdrawal.user._id).session(session);
    user.balance += withdrawal.amount;
    await user.save({ session });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.withdrawal_id': withdrawal_id },
      { 
        status: 'failed',
        description: `Withdrawal rejected: ${rejection_reason}`
      },
      { session }
    );

    await session.commitTransaction();

    // Notify user
    const io = req.app.get('io');
    io.to(`user-${withdrawal.user._id}`).emit('withdrawal-rejected', {
      message: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} was rejected`,
      amount: withdrawal.amount,
      reason: rejection_reason,
      withdrawalId: withdrawal._id,
      refundedAmount: withdrawal.amount
    });

    res.json({
      success: true,
      message: 'Withdrawal rejected and amount refunded',
      data: { withdrawal }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Reject withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while rejecting withdrawal'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get pending investments for admin
 * @route   GET /api/admin/pending-investments
 * @access  Private/Admin
 */
exports.getPendingInvestments = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const investments = await Investment.find({ status: 'pending' })
      .populate('user', 'full_name email phone')
      .populate('plan', 'name daily_interest duration min_amount')
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Investment.countDocuments({ status: 'pending' });

    res.json({
      success: true,
      data: {
        investments,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get pending investments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pending investments'
    });
  }
};

/**
 * @desc    Approve investment (Admin)
 * @route   POST /api/admin/approve-investment
 * @access  Private/Admin
 */
exports.approveInvestment = async (req, res) => {
  const session = await Investment.startSession();
  session.startTransaction();

  try {
    const { investment_id, admin_notes } = req.body;

    const investment = await Investment.findById(investment_id)
      .populate('user')
      .populate('plan')
      .session(session);

    if (!investment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    if (investment.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Investment already processed'
      });
    }

    // Update investment status
    investment.status = 'active';
    investment.start_date = new Date();
    investment.end_date = new Date(Date.now() + investment.plan.duration * 24 * 60 * 60 * 1000);
    investment.admin_notes = admin_notes;
    await investment.save({ session });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.investment_id': investment_id },
      { 
        status: 'completed',
        description: `Investment in ${investment.plan.name} approved`
      },
      { session }
    );

    await session.commitTransaction();

    // Process referral bonus if applicable
    if (investment.user.referred_by) {
      try {
        const referralBonus = investment.amount * 0.20; // 20% referral bonus
        
        // Update referrer's balance
        await User.findByIdAndUpdate(investment.user.referred_by, {
          $inc: {
            balance: referralBonus,
            referral_earnings: referralBonus
          }
        });

        // Create referral bonus transaction
        await Transaction.create({
          user: investment.user.referred_by,
          type: 'referral_bonus',
          amount: referralBonus,
          description: `Referral bonus from ${investment.user.full_name}`,
          status: 'completed',
          metadata: {
            referral_user_id: investment.user._id,
            referral_user_name: investment.user.full_name,
            investment_amount: investment.amount,
            bonus_percentage: 20
          }
        });

        // Notify referrer
        const io = req.app.get('io');
        io.to(`user-${investment.user.referred_by}`).emit('referral-bonus-earned', {
          message: `You earned ₦${referralBonus.toLocaleString()} referral bonus`,
          amount: referralBonus,
          fromUser: investment.user.full_name,
          investmentAmount: investment.amount
        });
      } catch (referralError) {
        logger.error('Referral bonus processing error:', referralError);
        // Don't fail the whole request if referral bonus fails
      }
    }

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${investment.user._id}`).emit('investment-approved', {
      message: `Your investment in ${investment.plan.name} has been approved`,
      investmentId: investment._id,
      planName: investment.plan.name,
      amount: investment.amount,
      duration: investment.plan.duration,
      dailyEarnings: investment.daily_earnings,
      totalReturns: investment.total_returns,
      endDate: investment.end_date
    });

    // Send approval email
    try {
      await sendEmail({
        email: investment.user.email,
        subject: 'Investment Approved - Raw Wealthy',
        template: 'investment-approved',
        data: {
          name: investment.user.full_name,
          planName: investment.plan.name,
          amount: investment.amount,
          duration: investment.plan.duration,
          dailyEarnings: investment.daily_earnings,
          totalReturns: investment.total_returns,
          endDate: investment.end_date.toLocaleDateString()
        }
      });
    } catch (emailError) {
      logger.error('Investment approval email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Investment approved successfully',
      data: { investment }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Approve investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while approving investment'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Reject investment (Admin)
 * @route   POST /api/admin/reject-investment
 * @access  Private/Admin
 */
exports.rejectInvestment = async (req, res) => {
  const session = await Investment.startSession();
  session.startTransaction();

  try {
    const { investment_id, rejection_reason } = req.body;

    const investment = await Investment.findById(investment_id)
      .populate('user')
      .populate('plan')
      .session(session);

    if (!investment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    if (investment.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Investment already processed'
      });
    }

    // Update investment status
    investment.status = 'rejected';
    investment.rejection_reason = rejection_reason;
    investment.updated_at = new Date();
    await investment.save({ session });

    // Refund amount to user balance
    const user = await User.findById(investment.user._id).session(session);
    user.balance += investment.amount;
    await user.save({ session });

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { 'metadata.investment_id': investment_id },
      { 
        status: 'failed',
        description: `Investment rejected: ${rejection_reason}`
      },
      { session }
    );

    await session.commitTransaction();

    // Notify user
    const io = req.app.get('io');
    io.to(`user-${investment.user._id}`).emit('investment-rejected', {
      message: `Your investment in ${investment.plan.name} was rejected`,
      amount: investment.amount,
      reason: rejection_reason,
      investmentId: investment._id,
      refundedAmount: investment.amount
    });

    res.json({
      success: true,
      message: 'Investment rejected and amount refunded',
      data: { investment }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Reject investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while rejecting investment'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get all users with filtering and pagination (Admin)
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
exports.getAllUsers = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      kyc_status,
      risk_tolerance,
      sort = '-created_at'
    } = req.query;
    
    // Build query
    const query = {};
    
    // Search filter
    if (search) {
      query.$or = [
        { full_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Status filters
    if (status === 'active') query.is_active = true;
    if (status === 'inactive') query.is_active = false;
    if (kyc_status === 'verified') query.kyc_verified = true;
    if (kyc_status === 'unverified') query.kyc_verified = false;
    if (kyc_status === 'pending') query.kyc_status = 'pending';
    if (risk_tolerance) query.risk_tolerance = risk_tolerance;

    const users = await User.find(query)
      .select('-password -two_factor_secret')
      .populate('referred_by', 'full_name email')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await User.countDocuments(query);

    // Calculate user statistics
    const userStats = await User.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        totalBalance: { $sum: '$balance' },
        totalEarnings: { $sum: '$total_earnings' },
        totalReferralEarnings: { $sum: '$referral_earnings' },
        averageBalance: { $avg: '$balance' }
      }}
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        },
        stats: userStats[0] || {
          totalBalance: 0,
          totalEarnings: 0,
          totalReferralEarnings: 0,
          averageBalance: 0
        }
      }
    });

  } catch (error) {
    logger.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching users'
    });
  }
};

/**
 * @desc    Get user details by ID (Admin)
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
exports.getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -two_factor_secret')
      .populate('referred_by', 'full_name email phone')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's investments
    const investments = await Investment.find({ user: req.params.id })
      .populate('plan', 'name daily_interest duration')
      .sort('-created_at')
      .limit(10)
      .lean();

    // Get user's transactions
    const transactions = await Transaction.find({ user: req.params.id })
      .sort('-created_at')
      .limit(20)
      .lean();

    // Get referral statistics
    const referralStats = await User.aggregate([
      { $match: { referred_by: user._id } },
      { $group: {
        _id: null,
        totalReferrals: { $sum: 1 },
        activeReferrals: { $sum: { $cond: [{ $eq: ['$is_active', true] }, 1, 0] } }
      }}
    ]);

    const userData = {
      ...user,
      statistics: {
        totalInvestments: investments.length,
        totalDeposits: transactions.filter(t => t.type === 'deposit').length,
        totalWithdrawals: transactions.filter(t => t.type === 'withdrawal').length,
        referralStats: referralStats[0] || { totalReferrals: 0, activeReferrals: 0 }
      },
      recentInvestments: investments,
      recentTransactions: transactions
    };

    res.json({
      success: true,
      data: { user: userData }
    });

  } catch (error) {
    logger.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching user details'
    });
  }
};

/**
 * @desc    Update user status (Admin)
 * @route   PUT /api/admin/users/:id/status
 * @access  Private/Admin
 */
exports.updateUserStatus = async (req, res) => {
  try {
    const { is_active, admin_notes } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        is_active,
        admin_notes,
        updated_at: new Date()
      },
      { new: true, runValidators: true }
    ).select('-password -two_factor_secret');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Notify user if account status changed
    const io = req.app.get('io');
    if (is_active === false) {
      io.to(`user-${user._id}`).emit('account-suspended', {
        message: 'Your account has been suspended',
        reason: admin_notes,
        timestamp: new Date()
      });
    } else if (is_active === true) {
      io.to(`user-${user._id}`).emit('account-activated', {
        message: 'Your account has been activated',
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: `User ${is_active ? 'activated' : 'suspended'} successfully`,
      data: { user }
    });

  } catch (error) {
    logger.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating user status'
    });
  }
};

/**
 * @desc    Get platform analytics
 * @route   GET /api/admin/analytics
 * @access  Private/Admin
 */
exports.getPlatformAnalytics = async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    switch (period) {
      case '7d':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case '30d':
        startDate = new Date(now.setDate(now.getDate() - 30));
        break;
      case '90d':
        startDate = new Date(now.setDate(now.getDate() - 90));
        break;
      case '1y':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setDate(now.getDate() - 30));
    }

    // User growth analytics
    const userGrowth = await User.aggregate([
      {
        $match: {
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$created_at' },
            month: { $month: '$created_at' },
            day: { $dayOfMonth: '$created_at' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Revenue analytics
    const revenueAnalytics = await Withdrawal.aggregate([
      {
        $match: {
          status: 'completed',
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$created_at' },
            month: { $month: '$created_at' },
            day: { $dayOfMonth: '$created_at' }
          },
          totalFees: { $sum: '$fee' },
          totalWithdrawals: { $sum: '$net_amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Investment analytics
    const investmentAnalytics = await Investment.aggregate([
      {
        $match: {
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$created_at' },
            month: { $month: '$created_at' },
            day: { $dayOfMonth: '$created_at' }
          },
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Plan performance analytics
    const planPerformance = await Investment.aggregate([
      {
        $match: {
          created_at: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$plan',
          totalInvestments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' }
        }
      },
      {
        $lookup: {
          from: 'investmentplans',
          localField: '_id',
          foreignField: '_id',
          as: 'planDetails'
        }
      },
      {
        $unwind: '$planDetails'
      },
      {
        $project: {
          planName: '$planDetails.name',
          totalInvestments: 1,
          totalAmount: 1,
          averageAmount: 1
        }
      },
      {
        $sort: { totalAmount: -1 }
      }
    ]);

    const analytics = {
      userGrowth,
      revenueAnalytics,
      investmentAnalytics,
      planPerformance,
      period,
      startDate,
      endDate: new Date()
    };

    res.json({
      success: true,
      data: { analytics }
    });

  } catch (error) {
    logger.error('Get platform analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching platform analytics'
    });
  }
};
