const Deposit = require('../models/Deposit');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

// @desc    Create deposit request
// @route   POST /api/deposits
// @access  Private
exports.createDeposit = async (req, res) => {
  try {
    const { amount, payment_method, transaction_hash } = req.body;

    // Validate amount
    if (amount < 3500) {
      return res.status(400).json({
        success: false,
        message: 'Minimum deposit amount is ₦3,500'
      });
    }

    // Create deposit record
    const deposit = await Deposit.create({
      user: req.user.id,
      amount,
      payment_method,
      transaction_hash: transaction_hash || null,
      status: 'pending'
    });

    // Create transaction record
    const transaction = await Transaction.create({
      user: req.user.id,
      type: 'deposit',
      amount: amount,
      description: `Deposit via ${payment_method}`,
      status: 'pending',
      metadata: {
        deposit_id: deposit._id,
        payment_method: payment_method
      }
    });

    // Notify admin via Socket.IO
    const io = req.app.get('io');
    io.to('admin-room').emit('new-deposit', {
      message: 'New deposit request',
      depositId: deposit._id,
      userId: req.user.id,
      userName: req.user.full_name,
      amount: amount,
      paymentMethod: payment_method
    });

    res.status(201).json({
      success: true,
      message: 'Deposit request submitted successfully. Waiting for admin approval.',
      data: { deposit, transaction }
    });

  } catch (error) {
    logger.error('Create deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing deposit'
    });
  }
};

// @desc    Get user deposits
// @route   GET /api/deposits
// @access  Private
exports.getUserDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    if (status) query.status = status;

    const deposits = await Deposit.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Deposit.countDocuments(query);

    // Calculate totals
    const totals = await Deposit.aggregate([
      { $match: { user: req.user._id } },
      { $group: { 
        _id: '$status', 
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }}
    ]);

    res.json({
      success: true,
      data: {
        deposits,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
        totals
      }
    });
  } catch (error) {
    logger.error('Get deposits error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching deposits'
    });
  }
};

// @desc    Get deposit by ID
// @route   GET /api/deposits/:id
// @access  Private
exports.getDeposit = async (req, res) => {
  try {
    const deposit = await Deposit.findById(req.params.id)
      .populate('user', 'full_name email');

    if (!deposit) {
      return res.status(404).json({
        success: false,
        message: 'Deposit not found'
      });
    }

    // Check ownership (unless admin)
    if (deposit.user._id.toString() !== req.user.id && req.user.role === 'user') {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this deposit'
      });
    }

    res.json({
      success: true,
      data: { deposit }
    });
  } catch (error) {
    logger.error('Get deposit error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching deposit'
    });
  }
};
