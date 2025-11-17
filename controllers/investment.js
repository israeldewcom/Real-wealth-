const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');
const { calculateDailyEarnings, calculateTotalReturns } = require('../utils/investmentCalculations');

/**
 * @desc    Create new investment
 * @route   POST /api/investments
 * @access  Private
 */
exports.createInvestment = async (req, res) => {
  const session = await Investment.startSession();
  session.startTransaction();

  try {
    const { plan_id, amount, auto_renew = false } = req.body;

    // Validate input
    if (!plan_id || !amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Plan ID and amount are required'
      });
    }

    // Check if plan exists and is active
    const plan = await InvestmentPlan.findById(plan_id);
    if (!plan || !plan.is_active) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Investment plan not found or inactive'
      });
    }

    // Validate minimum investment amount
    if (amount < plan.min_amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Minimum investment for ${plan.name} is ₦${plan.min_amount.toLocaleString()}`
      });
    }

    // Check user balance
    const user = await User.findById(req.user.id).session(session);
    if (user.balance < amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this investment'
      });
    }

    // Calculate investment details
    const dailyEarnings = calculateDailyEarnings(amount, plan.daily_interest);
    const totalReturns = calculateTotalReturns(amount, plan.total_interest);
    const endDate = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);

    // Create investment
    const investment = await Investment.create([{
      user: req.user.id,
      plan: plan_id,
      amount,
      daily_earnings: dailyEarnings,
      total_returns: totalReturns,
      duration: plan.duration,
      end_date: endDate,
      auto_renew,
      status: 'pending'
    }], { session });

    // Deduct amount from user balance
    user.balance -= amount;
    await user.save({ session });

    // Create transaction record
    await Transaction.create([{
      user: req.user.id,
      type: 'investment',
      amount: -amount,
      description: `Investment in ${plan.name}`,
      status: 'completed',
      metadata: {
        investment_id: investment[0]._id,
        plan_name: plan.name,
        duration: plan.duration
      }
    }], { session });

    // Commit transaction
    await session.commitTransaction();

    // Populate investment data for response
    const populatedInvestment = await Investment.findById(investment[0]._id)
      .populate('plan', 'name daily_interest total_interest duration')
      .populate('user', 'full_name email');

    // Notify admin via Socket.IO
    const io = req.app.get('io');
    io.to('admin-room').emit('new-investment', {
      message: 'New investment created',
      investmentId: investment[0]._id,
      userId: req.user.id,
      userName: user.full_name,
      planName: plan.name,
      amount: amount,
      status: 'pending'
    });

    // Notify user
    io.to(`user-${req.user.id}`).emit('investment-created', {
      message: 'Your investment has been created successfully',
      investmentId: investment[0]._id,
      planName: plan.name,
      amount: amount,
      dailyEarnings: dailyEarnings
    });

    res.status(201).json({
      success: true,
      message: 'Investment created successfully',
      data: { investment: populatedInvestment }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Create investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating investment'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get user investments
 * @route   GET /api/investments
 * @access  Private
 */
exports.getUserInvestments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, sort = '-created_at' } = req.query;
    
    // Build query
    const query = { user: req.user.id };
    if (status) query.status = status;

    // Get investments with pagination
    const investments = await Investment.find(query)
      .populate('plan', 'name daily_interest total_interest duration min_amount')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    // Get total count for pagination
    const total = await Investment.countDocuments(query);

    // Calculate totals
    const totals = await Investment.aggregate([
      { $match: { user: req.user._id } },
      { $group: {
        _id: '$status',
        totalAmount: { $sum: '$amount' },
        totalEarnings: { $sum: '$total_earnings' },
        count: { $sum: 1 }
      }}
    ]);

    // Calculate active investment stats
    const activeStats = await Investment.aggregate([
      { 
        $match: { 
          user: req.user._id,
          status: 'active'
        }
      },
      { $group: {
        _id: null,
        totalActiveAmount: { $sum: '$amount' },
        totalDailyEarnings: { $sum: '$daily_earnings' },
        activeCount: { $sum: 1 }
      }}
    ]);

    res.json({
      success: true,
      data: {
        investments,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        },
        totals: totals.reduce((acc, curr) => {
          acc[curr._id] = curr;
          return acc;
        }, {}),
        activeStats: activeStats[0] || {
          totalActiveAmount: 0,
          totalDailyEarnings: 0,
          activeCount: 0
        }
      }
    });

  } catch (error) {
    logger.error('Get investments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching investments'
    });
  }
};

/**
 * @desc    Get investment by ID
 * @route   GET /api/investments/:id
 * @access  Private
 */
exports.getInvestment = async (req, res) => {
  try {
    const investment = await Investment.findById(req.params.id)
      .populate('plan')
      .populate('user', 'full_name email');

    if (!investment) {
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    // Check ownership (unless admin)
    if (investment.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this investment'
      });
    }

    // Calculate progress and time remaining for active investments
    let progress = {};
    if (investment.status === 'active') {
      const now = new Date();
      const start = new Date(investment.start_date);
      const end = new Date(investment.end_date);
      const totalDuration = end - start;
      const elapsed = now - start;
      
      progress = {
        percentage: Math.min(100, Math.round((elapsed / totalDuration) * 100)),
        daysElapsed: Math.floor(elapsed / (1000 * 60 * 60 * 24)),
        daysRemaining: Math.max(0, Math.floor((end - now) / (1000 * 60 * 60 * 24))),
        estimatedCompletion: investment.end_date
      };
    }

    res.json({
      success: true,
      data: { 
        investment: {
          ...investment.toObject(),
          progress
        }
      }
    });

  } catch (error) {
    logger.error('Get investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching investment'
    });
  }
};

/**
 * @desc    Get all investments (Admin)
 * @route   GET /api/investments/admin/all
 * @access  Private/Admin
 */
exports.getAllInvestments = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      plan, 
      user, 
      startDate, 
      endDate,
      sort = '-created_at'
    } = req.query;
    
    // Build query
    const query = {};
    if (status) query.status = status;
    if (plan) query.plan = plan;
    if (user) query.user = user;
    
    // Date range filter
    if (startDate || endDate) {
      query.created_at = {};
      if (startDate) query.created_at.$gte = new Date(startDate);
      if (endDate) query.created_at.$lte = new Date(endDate);
    }

    const investments = await Investment.find(query)
      .populate('plan', 'name daily_interest duration')
      .populate('user', 'full_name email phone')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Investment.countDocuments(query);

    // Calculate platform totals
    const platformStats = await Investment.aggregate([
      { $match: query },
      { $group: {
        _id: '$status',
        totalAmount: { $sum: '$amount' },
        totalEarnings: { $sum: '$total_earnings' },
        count: { $sum: 1 }
      }}
    ]);

    res.json({
      success: true,
      data: {
        investments,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        },
        platformStats: platformStats.reduce((acc, curr) => {
          acc[curr._id] = curr;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    logger.error('Get all investments error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching investments'
    });
  }
};

/**
 * @desc    Update investment status (Admin)
 * @route   PUT /api/investments/admin/:id/status
 * @access  Private/Admin
 */
exports.updateInvestmentStatus = async (req, res) => {
  const session = await Investment.startSession();
  session.startTransaction();

  try {
    const { status, admin_notes } = req.body;

    const investment = await Investment.findById(req.params.id)
      .populate('plan')
      .populate('user')
      .session(session);

    if (!investment) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Investment not found'
      });
    }

    // Validate status transition
    const validTransitions = {
      'pending': ['active', 'rejected'],
      'active': ['completed', 'cancelled'],
      'completed': [],
      'cancelled': [],
      'rejected': []
    };

    if (!validTransitions[investment.status]?.includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Invalid status transition from ${investment.status} to ${status}`
      });
    }

    // Update investment
    investment.status = status;
    investment.admin_notes = admin_notes;
    investment.updated_at = new Date();

    // Handle specific status changes
    if (status === 'active') {
      investment.start_date = new Date();
      investment.end_date = new Date(Date.now() + investment.plan.duration * 24 * 60 * 60 * 1000);
    } else if (status === 'completed') {
      investment.completed_at = new Date();
      
      // Add returns to user balance if not auto-renew
      if (!investment.auto_renew) {
        const user = await User.findById(investment.user._id).session(session);
        user.balance += investment.total_returns;
        await user.save({ session });

        // Create earnings transaction
        await Transaction.create([{
          user: investment.user._id,
          type: 'investment_earnings',
          amount: investment.total_returns,
          description: `Investment earnings from ${investment.plan.name}`,
          status: 'completed',
          metadata: {
            investment_id: investment._id,
            plan_name: investment.plan.name,
            principal: investment.amount,
            earnings: investment.total_returns - investment.amount
          }
        }], { session });
      }

      // Handle auto-renew
      if (investment.auto_renew) {
        // Create new investment with same parameters
        const newInvestment = await Investment.create([{
          user: investment.user._id,
          plan: investment.plan._id,
          amount: investment.amount,
          daily_earnings: investment.daily_earnings,
          total_returns: investment.total_returns,
          duration: investment.plan.duration,
          auto_renew: true,
          status: 'active',
          start_date: new Date(),
          end_date: new Date(Date.now() + investment.plan.duration * 24 * 60 * 60 * 1000)
        }], { session });

        // Notify user about auto-renewal
        const io = req.app.get('io');
        io.to(`user-${investment.user._id}`).emit('investment-auto-renewed', {
          message: `Your investment in ${investment.plan.name} has been automatically renewed`,
          oldInvestmentId: investment._id,
          newInvestmentId: newInvestment[0]._id,
          amount: investment.amount
        });
      }
    } else if (status === 'rejected' || status === 'cancelled') {
      // Refund amount to user
      const user = await User.findById(investment.user._id).session(session);
      user.balance += investment.amount;
      await user.save({ session });

      // Update transaction status
      await Transaction.findOneAndUpdate(
        { 'metadata.investment_id': investment._id },
        { status: 'failed', description: `Investment ${status}` },
        { session }
      );
    }

    await investment.save({ session });
    await session.commitTransaction();

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${investment.user._id}`).emit('investment-status-updated', {
      message: `Your investment status has been updated to ${status}`,
      investmentId: investment._id,
      planName: investment.plan.name,
      newStatus: status,
      adminNotes: admin_notes
    });

    res.json({
      success: true,
      message: `Investment ${status} successfully`,
      data: { investment }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Update investment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating investment status'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Calculate investment returns
 * @route   POST /api/investments/calculate-returns
 * @access  Public
 */
exports.calculateReturns = async (req, res) => {
  try {
    const { plan_id, amount } = req.body;

    if (!plan_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Plan ID and amount are required'
      });
    }

    const plan = await InvestmentPlan.findById(plan_id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Investment plan not found'
      });
    }

    if (amount < plan.min_amount) {
      return res.status(400).json({
        success: false,
        message: `Amount below minimum investment of ₦${plan.min_amount.toLocaleString()}`
      });
    }

    const calculations = {
      principal: amount,
      daily_interest: plan.daily_interest,
      total_interest: plan.total_interest,
      duration: plan.duration,
      daily_earnings: calculateDailyEarnings(amount, plan.daily_interest),
      total_returns: calculateTotalReturns(amount, plan.total_interest),
      total_earnings: calculateTotalReturns(amount, plan.total_interest) - amount,
      roi_percentage: plan.total_interest
    };

    res.json({
      success: true,
      data: { calculations }
    });

  } catch (error) {
    logger.error('Calculate returns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while calculating returns'
    });
  }
};
