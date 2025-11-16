const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

// @desc    Create withdrawal request
// @route   POST /api/withdrawals
// @access  Private
exports.createWithdrawal = async (req, res) => {
  try {
    const { amount, payment_method, bank_name, account_name, account_number, wallet_address } = req.body;

    // Validate amount
    if (amount < 3500) {
      return res.status(400).json({
        success: false,
        message: 'Minimum withdrawal amount is ₦3,500'
      });
    }

    // Calculate fees
    const fee = amount * 0.05; // 5% platform fee
    const net_amount = amount - fee;

    // Check user balance
    const user = await User.findById(req.user.id);
    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for withdrawal'
      });
    }

    // Prepare withdrawal data
    const withdrawalData = {
      user: req.user.id,
      amount,
      fee,
      net_amount,
      payment_method,
      status: 'pending'
    };

    // Add payment-specific details
    if (payment_method === 'bank_transfer') {
      withdrawalData.bank_details = {
        bank_name,
        account_name,
        account_number
      };
    } else if (payment_method === 'crypto') {
      withdrawalData.wallet_address = wallet_address;
    }

    // Create withdrawal record
    const withdrawal = await Withdrawal.create(withdrawalData);

    // Create transaction record
    const transaction = await Transaction.create({
      user: req.user.id,
      type: 'withdrawal',
      amount: -amount,
      description: `Withdrawal via ${payment_method}`,
      status: 'pending',
      metadata: {
        withdrawal_id: withdrawal._id,
        payment_method: payment_method,
        fee: fee,
        net_amount: net_amount
      }
    });

    // Notify admin via Socket.IO
    const io = req.app.get('io');
    io.to('admin-room').emit('new-withdrawal', {
      message: 'New withdrawal request',
      withdrawalId: withdrawal._id,
      userId: req.user.id,
      userName: user.full_name,
      amount: amount,
      netAmount: net_amount,
      fee: fee,
      paymentMethod: payment_method
    });

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully. Waiting for admin approval.',
      data: { withdrawal, transaction }
    });

  } catch (error) {
    logger.error('Create withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing withdrawal'
    });
  }
};

// @desc    Get user withdrawals
// @route   GET /api/withdrawals
// @access  Private
exports.getUserWithdrawals = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    if (status) query.status = status;

    const withdrawals = await Withdrawal.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Withdrawal.countDocuments(query);

    // Calculate totals
    const totals = await Withdrawal.aggregate([
      { $match: { user: req.user._id } },
      { $group: { 
        _id: '$status', 
        totalAmount: { $sum: '$amount' },
        totalFees: { $sum: '$fee' },
        totalNet: { $sum: '$net_amount' },
        count: { $sum: 1 }
      }}
    ]);

    res.json({
      success: true,
      data: {
        withdrawals,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
        totals
      }
    });
  } catch (error) {
    logger.error('Get withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching withdrawals'
    });
  }
};
