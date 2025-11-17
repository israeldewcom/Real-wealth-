const mongoose = require('mongoose');

const investmentPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  min_amount: {
    type: Number,
    required: true,
    min: 3500
  },
  max_amount: {
    type: Number,
    required: true,
    validate: {
      validator: function(value) {
        return value > this.min_amount;
      },
      message: 'Max amount must be greater than min amount'
    }
  },
  daily_interest: {
    type: Number,
    required: true,
    min: 0.1,
    max: 50
  },
  total_interest: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  duration: {
    type: Number, // in days
    required: true,
    min: 1,
    max: 365
  },
  risk_level: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'medium-high', 'high', 'very-high', 'maximum'],
    default: 'medium'
  },
  category: {
    type: String,
    required: true,
    enum: ['entry', 'growth', 'premium', 'ultra-premium', 'exclusive']
  },
  features: [{
    type: String
  }],
  is_popular: {
    type: Boolean,
    default: false
  },
  is_active: {
    type: Boolean,
    default: true
  },
  popularity_score: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  investment_count: {
    type: Number,
    default: 0
  },
  total_invested: {
    type: Number,
    default: 0
  },
  average_rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  tags: [{
    type: String,
    enum: ['beginner-friendly', 'high-returns', 'quick-returns', 'long-term', 'premium', 'exclusive', 'featured']
  }],
  requirements: {
    kyc_required: {
      type: Boolean,
      default: true
    },
    min_balance: {
      type: Number,
      default: 0
    },
    verified_phone: {
      type: Boolean,
      default: true
    }
  },
  performance_metrics: {
    success_rate: {
      type: Number,
      default: 95,
      min: 0,
      max: 100
    },
    avg_completion_rate: {
      type: Number,
      default: 98,
      min: 0,
      max: 100
    },
    historical_returns: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for calculated returns
investmentPlanSchema.virtual('estimated_returns').get(function() {
  return (this.min_amount * this.total_interest) / 100;
});

// Virtual for daily return amount
investmentPlanSchema.virtual('daily_return_amount').get(function() {
  return (this.min_amount * this.daily_interest) / 100;
});

// Indexes for performance
investmentPlanSchema.index({ category: 1, min_amount: 1 });
investmentPlanSchema.index({ risk_level: 1 });
investmentPlanSchema.index({ is_popular: -1, popularity_score: -1 });
investmentPlanSchema.index({ is_active: 1 });

// Static method to get plans by risk level
investmentPlanSchema.statics.findByRiskLevel = function(riskLevel) {
  return this.find({ risk_level: riskLevel, is_active: true });
};

// Static method to get popular plans
investmentPlanSchema.statics.getPopularPlans = function(limit = 6) {
  return this.find({ 
    is_popular: true, 
    is_active: true 
  })
  .sort({ popularity_score: -1 })
  .limit(limit);
};

// Static method to get plans by category
investmentPlanSchema.statics.getByCategory = function(category) {
  return this.find({ 
    category: category, 
    is_active: true 
  }).sort({ min_amount: 1 });
};

// Instance method to calculate returns for specific amount
investmentPlanSchema.methods.calculateReturns = function(amount) {
  if (amount < this.min_amount || amount > this.max_amount) {
    throw new Error(`Amount must be between ${this.min_amount} and ${this.max_amount}`);
  }
  
  const dailyReturn = (amount * this.daily_interest) / 100;
  const totalReturn = (amount * this.total_interest) / 100;
  const netProfit = totalReturn - amount;
  
  return {
    principal: amount,
    daily_return: dailyReturn,
    total_return: totalReturn,
    net_profit: netProfit,
    roi_percentage: this.total_interest,
    duration: this.duration,
    daily_breakdown: Array.from({ length: this.duration }, (_, i) => ({
      day: i + 1,
      earnings: dailyReturn,
      cumulative: dailyReturn * (i + 1)
    }))
  };
};

module.exports = mongoose.model('InvestmentPlan', investmentPlanSchema);
