const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [3500, 'Minimum withdrawal amount is ₦3,500']
  },
  fee: {
    type: Number,
    required: true,
    default: 0
  },
  net_amount: {
    type: Number,
    required: true
  },
  payment_method: {
    type: String,
    required: true,
    enum: ['bank_transfer', 'crypto', 'paypal']
  },
  bank_details: {
    bank_name: String,
    account_name: String,
    account_number: String
  },
  wallet_address: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'processing', 'completed'],
    default: 'pending'
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approved_at: Date,
  processed_at: Date,
  completed_at: Date,
  rejection_reason: String,
  transaction_hash: String
}, {
  timestamps: true
});

// Indexes
withdrawalSchema.index({ user: 1, created_at: -1 });
withdrawalSchema.index({ status: 1 });
withdrawalSchema.index({ payment_method: 1 });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
