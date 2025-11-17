const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

/**
 * @desc    Get all investment plans with advanced filtering
 * @route   GET /api/plans
 * @access  Public
 */
exports.getInvestmentPlans = async (req, res) => {
  try {
    const { 
      category, 
      risk_level, 
      min_amount, 
      max_amount, 
      duration,
      sort_by = 'min_amount',
      sort_order = 'asc',
      page = 1,
      limit = 15,
      featured
    } = req.query;

    // Build query
    const query = { is_active: true };
    
    if (category) query.category = category;
    if (risk_level) query.risk_level = risk_level;
    if (featured === 'true') query.is_popular = true;
    
    // Amount range filter
    if (min_amount || max_amount) {
      query.min_amount = {};
      if (min_amount) query.min_amount.$gte = parseInt(min_amount);
      if (max_amount) query.min_amount.$lte = parseInt(max_amount);
    }

    // Duration filter
    if (duration) {
      query.duration = { $lte: parseInt(duration) };
    }

    // Sort configuration
    const sortConfig = {};
    sortConfig[sort_by] = sort_order === 'desc' ? -1 : 1;

    // Get plans with pagination
    const plans = await InvestmentPlan.find(query)
      .sort(sortConfig)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await InvestmentPlan.countDocuments(query);

    // Calculate aggregation stats
    const stats = await InvestmentPlan.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalPlans: { $sum: 1 },
          avgDailyInterest: { $avg: '$daily_interest' },
          avgTotalInterest: { $avg: '$total_interest' },
          minInvestment: { $min: '$min_amount' },
          maxInvestment: { $max: '$max_amount' },
          totalCategories: { $addToSet: '$category' }
        }
      }
    ]);

    // Category distribution
    const categoryStats = await InvestmentPlan.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgReturn: { $avg: '$total_interest' },
          minAmount: { $min: '$min_amount' },
          maxAmount: { $max: '$max_amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        plans: plans.map(plan => ({
          ...plan,
          estimated_returns: (plan.min_amount * plan.total_interest) / 100,
          daily_return_amount: (plan.min_amount * plan.daily_interest) / 100
        })),
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: parseInt(page),
          total,
          limit: parseInt(limit)
        },
        stats: stats[0] || {},
        categories: categoryStats,
        filters: {
          available_categories: ['entry', 'growth', 'premium', 'ultra-premium', 'exclusive'],
          available_risk_levels: ['low', 'medium', 'medium-high', 'high', 'very-high', 'maximum'],
          price_ranges: {
            entry: { min: 3500, max: 25000 },
            growth: { min: 23500, max: 150000 },
            premium: { min: 63500, max: 400000 },
            'ultra-premium': { min: 113500, max: 1500000 },
            exclusive: { min: 153500, max: 5000000 }
          }
        }
      }
    });

  } catch (error) {
    logger.error('Get investment plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching investment plans'
    });
  }
};

/**
 * @desc    Get plan details with advanced calculations
 * @route   GET /api/plans/:id
 * @access  Public
 */
exports.getPlanDetails = async (req, res) => {
  try {
    const plan = await InvestmentPlan.findById(req.params.id);
    
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Investment plan not found'
      });
    }

    // Calculate various investment scenarios
    const scenarios = [plan.min_amount, plan.min_amount * 5, plan.min_amount * 10]
      .filter(amount => amount <= plan.max_amount)
      .map(amount => ({
        amount,
        ...plan.calculateReturns(amount)
      }));

    // Get similar plans
    const similarPlans = await InvestmentPlan.find({
      _id: { $ne: plan._id },
      category: plan.category,
      is_active: true
    }).limit(4);

    // Plan performance analytics
    const planStats = await Investment.aggregate([
      { $match: { plan: plan._id, status: 'completed' } },
      {
        $group: {
          _id: '$plan',
          totalInvestments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          successRate: { 
            $avg: { 
              $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] 
            } 
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        plan: {
          ...plan.toObject(),
          estimated_returns: (plan.min_amount * plan.total_interest) / 100,
          daily_return_amount: (plan.min_amount * plan.daily_interest) / 100
        },
        scenarios,
        similar_plans: similarPlans,
        performance: planStats[0] || {
          totalInvestments: 0,
          totalAmount: 0,
          avgAmount: 0,
          successRate: 0
        },
        recommendations: {
          best_for: getPlanRecommendation(plan),
          risk_analysis: analyzeRiskProfile(plan),
          suitability_score: calculateSuitabilityScore(plan)
        }
      }
    });

  } catch (error) {
    logger.error('Get plan details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching plan details'
    });
  }
};

/**
 * @desc    Calculate advanced investment returns
 * @route   POST /api/investments/calculate-advanced
 * @access  Public
 */
exports.calculateAdvancedReturns = async (req, res) => {
  try {
    const { plan_id, amount, duration_months, compound_frequency } = req.body;

    const plan = await InvestmentPlan.findById(plan_id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Investment plan not found'
      });
    }

    if (amount < plan.min_amount || amount > plan.max_amount) {
      return res.status(400).json({
        success: false,
        message: `Investment amount must be between ₦${plan.min_amount.toLocaleString()} and ₦${plan.max_amount.toLocaleString()}`
      });
    }

    const calculations = calculateAdvancedInvestmentReturns(
      amount, 
      plan.daily_interest, 
      plan.duration,
      duration_months,
      compound_frequency
    );

    res.json({
      success: true,
      data: {
        basic_calculation: plan.calculateReturns(amount),
        advanced_calculation: calculations,
        comparison: compareInvestmentStrategies(amount, plan),
        risk_assessment: assessInvestmentRisk(plan, amount)
      }
    });

  } catch (error) {
    logger.error('Calculate advanced returns error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while calculating returns'
    });
  }
};

/**
 * @desc    Create advanced investment with multiple options
 * @route   POST /api/investments/advanced
 * @access  Private
 */
exports.createAdvancedInvestment = async (req, res) => {
  const session = await Investment.startSession();
  session.startTransaction();

  try {
    const { 
      plan_id, 
      amount, 
      strategy = 'standard',
      auto_renew = false,
      risk_management = 'conservative',
      target_amount,
      stop_loss 
    } = req.body;

    // Validate plan
    const plan = await InvestmentPlan.findById(plan_id);
    if (!plan || !plan.is_active) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Investment plan not found or inactive'
      });
    }

    // Validate amount range
    if (amount < plan.min_amount || amount > plan.max_amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Amount must be between ₦${plan.min_amount.toLocaleString()} and ₦${plan.max_amount.toLocaleString()}`
      });
    }

    // Check user balance and risk tolerance
    const user = await User.findById(req.user.id).session(session);
    if (user.balance < amount) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for this investment'
      });
    }

    // Risk validation for high-tier plans
    if (plan.risk_level === 'high' && user.risk_tolerance === 'low') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'This plan requires higher risk tolerance. Please update your risk profile.'
      });
    }

    // Calculate investment details
    const dailyEarnings = (amount * plan.daily_interest) / 100;
    const totalReturns = (amount * plan.total_interest) / 100;
    const endDate = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);

    // Create advanced investment
    const investment = await Investment.create([{
      user: req.user.id,
      plan: plan_id,
      amount,
      daily_earnings: dailyEarnings,
      total_returns: totalReturns,
      duration: plan.duration,
      end_date: endDate,
      auto_renew,
      strategy,
      risk_management,
      target_amount,
      stop_loss,
      status: 'active',
      metadata: {
        risk_level: plan.risk_level,
        category: plan.category,
        strategy_applied: strategy,
        risk_management_setting: risk_management
      }
    }], { session });

    // Deduct amount from user balance
    user.balance -= amount;
    user.total_invested += amount;
    await user.save({ session });

    // Create transaction record
    await Transaction.create([{
      user: req.user.id,
      type: 'investment',
      amount: -amount,
      description: `Advanced investment in ${plan.name} (${strategy} strategy)`,
      status: 'completed',
      metadata: {
        investment_id: investment[0]._id,
        plan_name: plan.name,
        strategy: strategy,
        risk_management: risk_management
      }
    }], { session });

    // Update plan statistics
    await InvestmentPlan.findByIdAndUpdate(
      plan_id,
      {
        $inc: {
          investment_count: 1,
          total_invested: amount
        }
      },
      { session }
    );

    await session.commitTransaction();

    // Populate investment for response
    const populatedInvestment = await Investment.findById(investment[0]._id)
      .populate('plan')
      .populate('user', 'full_name email');

    // Real-time notifications
    const io = req.app.get('io');
    io.to(`user-${req.user.id}`).emit('advanced-investment-created', {
      message: `Advanced investment in ${plan.name} created successfully`,
      investmentId: investment[0]._id,
      planName: plan.name,
      amount: amount,
      strategy: strategy,
      expectedReturns: totalReturns,
      endDate: endDate
    });

    // Notify admin for large investments
    if (amount >= 100000) {
      io.to('admin-room').emit('large-investment', {
        message: 'Large investment created',
        investmentId: investment[0]._id,
        userName: user.full_name,
        amount: amount,
        planName: plan.name
      });
    }

    res.status(201).json({
      success: true,
      message: 'Advanced investment created successfully',
      data: { 
        investment: populatedInvestment,
        strategy_details: getStrategyDetails(strategy),
        risk_analysis: analyzeInvestmentRisk(investment[0])
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Create advanced investment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating advanced investment'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get investment analytics and performance
 * @route   GET /api/investments/analytics
 * @access  Private
 */
exports.getInvestmentAnalytics = async (req, res) => {
  try {
    const userId = req.user.id;

    // Overall investment stats
    const overallStats = await Investment.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalInvested: { $sum: '$amount' },
          totalEarnings: { $sum: '$total_earnings' },
          activeInvestments: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          completedInvestments: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          avgReturnRate: { $avg: '$daily_earnings' }
        }
      }
    ]);

    // Category-wise distribution
    const categoryStats = await Investment.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'investmentplans',
          localField: 'plan',
          foreignField: '_id',
          as: 'planDetails'
        }
      },
      { $unwind: '$planDetails' },
      {
        $group: {
          _id: '$planDetails.category',
          totalAmount: { $sum: '$amount' },
          totalEarnings: { $sum: '$total_earnings' },
          count: { $sum: 1 },
          avgDailyReturn: { $avg: '$daily_earnings' }
        }
      }
    ]);

    // Risk profile analysis
    const riskAnalysis = await Investment.aggregate([
      { $match: { user: mongoose.Types.ObjectId(userId) } },
      {
        $lookup: {
          from: 'investmentplans',
          localField: 'plan',
          foreignField: '_id',
          as: 'planDetails'
        }
      },
      { $unwind: '$planDetails' },
      {
        $group: {
          _id: '$planDetails.risk_level',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          successRate: { 
            $avg: { 
              $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] 
            } 
          }
        }
      }
    ]);

    // Recent performance
    const recentPerformance = await Investment.find({ user: userId })
      .populate('plan', 'name category risk_level')
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: {
        overall: overallStats[0] || {
          totalInvested: 0,
          totalEarnings: 0,
          activeInvestments: 0,
          completedInvestments: 0,
          avgReturnRate: 0
        },
        categories: categoryStats,
        risk_analysis: riskAnalysis,
        recent_performance: recentPerformance,
        recommendations: generateInvestmentRecommendations(userId, categoryStats)
      }
    });

  } catch (error) {
    logger.error('Get investment analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching investment analytics'
    });
  }
};

// Helper functions
function calculateAdvancedInvestmentReturns(amount, dailyInterest, duration, months, compoundFreq) {
  // Implementation for advanced calculations
  const dailyRate = dailyInterest / 100;
  const totalDays = months ? months * 30 : duration;
  
  const returns = {
    simple: amount * dailyRate * totalDays,
    compounded: amount * Math.pow(1 + dailyRate, totalDays) - amount,
    monthly_breakdown: []
  };

  // Generate monthly breakdown
  for (let month = 1; month <= (months || Math.ceil(duration / 30)); month++) {
    const monthEarnings = amount * dailyRate * 30 * month;
    returns.monthly_breakdown.push({
      month,
      earnings: monthEarnings,
      total: amount + monthEarnings
    });
  }

  return returns;
}

function compareInvestmentStrategies(amount, plan) {
  const strategies = ['standard', 'aggressive', 'conservative'];
  return strategies.map(strategy => ({
    strategy,
    ...calculateStrategyReturns(amount, plan, strategy)
  }));
}

function calculateStrategyReturns(amount, plan, strategy) {
  const multipliers = {
    standard: 1,
    aggressive: 1.2,
    conservative: 0.8
  };

  const multiplier = multipliers[strategy];
  const dailyReturn = (amount * plan.daily_interest * multiplier) / 100;
  const totalReturn = (amount * plan.total_interest * multiplier) / 100;

  return {
    daily_return: dailyReturn,
    total_return: totalReturn,
    risk_level: strategy === 'aggressive' ? 'high' : strategy === 'conservative' ? 'low' : 'medium'
  };
}

function assessInvestmentRisk(plan, amount) {
  const riskScores = {
    low: 1,
    medium: 2,
    'medium-high': 3,
    high: 4,
    'very-high': 5,
    maximum: 6
  };

  const score = riskScores[plan.risk_level] || 2;
  const amountRisk = amount > 100000 ? 2 : amount > 50000 ? 1 : 0;

  return {
    overall_risk: score + amountRisk,
    risk_level: getRiskLevel(score + amountRisk),
    factors: [
      `Plan risk: ${plan.risk_level}`,
      amount > 100000 ? 'High investment amount' : 'Moderate investment amount',
      plan.duration > 30 ? 'Long duration' : 'Short to medium duration'
    ],
    recommendations: generateRiskRecommendations(score + amountRisk)
  };
}

function getRiskLevel(score) {
  if (score <= 2) return 'Low';
  if (score <= 4) return 'Medium';
  if (score <= 6) return 'High';
  return 'Very High';
}

function generateRiskRecommendations(score) {
  const recommendations = {
    low: ['Suitable for conservative investors', 'Minimal monitoring required'],
    medium: ['Regular monitoring recommended', 'Consider diversification'],
    high: ['Active monitoring required', 'Consider risk management strategies'],
    'very-high': ['Professional advice recommended', 'Implement strict risk controls']
  };

  return recommendations[getRiskLevel(score).toLowerCase()] || [];
}

function getPlanRecommendation(plan) {
  const recommendations = {
    entry: 'Beginners and conservative investors',
    growth: 'Investors seeking balanced growth',
    premium: 'Experienced investors with higher risk tolerance',
    'ultra-premium': 'Sophisticated investors seeking premium returns',
    exclusive: 'Ultra-high net worth investors and institutions'
  };

  return recommendations[plan.category] || 'General investors';
}

function analyzeRiskProfile(plan) {
  const analysis = {
    low: 'Minimal risk with stable returns',
    medium: 'Moderate risk with good growth potential',
    'medium-high': 'Elevated risk with higher growth potential',
    high: 'High risk with substantial return potential',
    'very-high': 'Very high risk for aggressive growth',
    maximum: 'Maximum risk for exceptional returns'
  };

  return analysis[plan.risk_level] || 'Risk profile not specified';
}

function calculateSuitabilityScore(plan) {
  const scores = {
    low: 90,
    medium: 75,
    'medium-high': 60,
    high: 45,
    'very-high': 30,
    maximum: 15
  };

  return scores[plan.risk_level] || 50;
}

function getStrategyDetails(strategy) {
  const strategies = {
    standard: {
      description: 'Balanced approach with moderate risk',
      recommended_for: 'Most investors',
      monitoring_level: 'Medium'
    },
    aggressive: {
      description: 'High-growth strategy with increased risk',
      recommended_for: 'Experienced investors',
      monitoring_level: 'High'
    },
    conservative: {
      description: 'Capital preservation with lower returns',
      recommended_for: 'Risk-averse investors',
      monitoring_level: 'Low'
    }
  };

  return strategies[strategy] || strategies.standard;
}

function analyzeInvestmentRisk(investment) {
  return {
    risk_score: Math.floor(Math.random() * 100),
    volatility: 'Medium',
    diversification_impact: 'Positive',
    liquidity: investment.duration <= 30 ? 'High' : 'Medium'
  };
}

function generateInvestmentRecommendations(userId, categoryStats) {
  // Simple recommendation engine
  const recommendations = [];
  
  if (!categoryStats.find(cat => cat._id === 'premium')) {
    recommendations.push('Consider premium plans for higher returns');
  }
  
  if (categoryStats.length < 3) {
    recommendations.push('Diversify across more investment categories');
  }

  return recommendations.length > 0 ? recommendations : ['Your portfolio is well diversified'];
}

module.exports = exports;
