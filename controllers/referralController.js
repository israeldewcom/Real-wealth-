const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

// @desc    Get referral statistics
// @route   GET /api/referrals/stats
// @access  Private
exports.getReferralStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    // Get referral counts
    const totalReferrals = await User.countDocuments({ referred_by: req.user.id });
    const activeReferrals = await User.countDocuments({ 
      referred_by: req.user.id, 
      is_active: true 
    });

    // Get referral earnings from transactions
    const referralEarnings = await Transaction.aggregate([
      {
        $match: {
          user: req.user._id,
          type: 'referral_bonus',
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$amount' },
          pendingEarnings: { 
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0]
            }
          }
        }
      }
    ]);

    const stats = {
      total_referrals: totalReferrals,
      active_referrals: activeReferrals,
      total_earnings: referralEarnings[0]?.totalEarnings || 0,
      pending_earnings: referralEarnings[0]?.pendingEarnings || 0
    };

    res.json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    logger.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching referral statistics'
    });
  }
};

// @desc    Get referral list
// @route   GET /api/referrals/list
// @access  Private
exports.getReferralList = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const referrals = await User.find({ referred_by: req.user.id })
      .select('full_name email phone created_at is_active total_earnings')
      .sort({ created_at: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments({ referred_by: req.user.id });

    res.json({
      success: true,
      data: {
        referrals,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      }
    });
  } catch (error) {
    logger.error('Get referral list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching referral list'
    });
  }
};

// @desc    Process referral bonus
// @route   POST /api/referrals/process-bonus
// @access  Private/Admin
exports.processReferralBonus = async (req, res) => {
  try {
    const { referral_user_id, investment_amount } = req.body;

    const referralUser = await User.findById(referral_user_id);
    if (!referralUser || !referralUser.referred_by) {
      return res.status(404).json({
        success: false,
        message: 'Referral user not found or not referred by anyone'
      });
    }

    // Calculate referral bonus (20% of first investment)
    const bonusAmount = investment_amount * 0.20;

    // Update referrer's balance and earnings
    await User.findByIdAndUpdate(referralUser.referred_by, {
      $inc: {
        balance: bonusAmount,
        referral_earnings: bonusAmount
      }
    });

    // Create referral bonus transaction
    await Transaction.create({
      user: referralUser.referred_by,
      type: 'referral_bonus',
      amount: bonusAmount,
      description: `Referral bonus from ${referralUser.full_name}`,
      status: 'completed',
      metadata: {
        referral_user_id: referral_user_id,
        referral_user_name: referralUser.full_name,
        investment_amount: investment_amount
      }
    });

    res.json({
      success: true,
      message: 'Referral bonus processed successfully',
      data: { bonusAmount }
    });

  } catch (error) {
    logger.error('Process referral bonus error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing referral bonus'
    });
  }
};
