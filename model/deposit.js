const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [3500, 'Minimum deposit amount is ₦3,500']
  },
  payment_method: {
    type: String,
    required: true,
    enum: ['bank_transfer', 'crypto', 'paypal', 'card']
  },
  transaction_hash: {
    type: String,
    sparse: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending'
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approved_at: Date,
  rejection_reason: String,
  proof_image: String
}, {
  timestamps: true
});

// Indexes
depositSchema.index({ user: 1, created_at: -1 });
depositSchema.index({ status: 1 });
depositSchema.index({ payment_method: 1 });

module.exports = mongoose.model('Deposit', depositSchema);
