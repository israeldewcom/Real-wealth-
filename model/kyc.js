const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  id_type: {
    type: String,
    required: true,
    enum: ['national_id', 'passport', 'driver_license']
  },
  id_number: {
    type: String,
    required: true
  },
  id_front: {
    type: String,
    required: true
  },
  id_back: {
    type: String,
    required: true
  },
  selfie_with_id: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  verified_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verified_at: Date,
  rejection_reason: String,
  notes: String
}, {
  timestamps: true
});

// Indexes
kycSchema.index({ user: 1 });
kycSchema.index({ status: 1 });
kycSchema.index({ id_number: 1 });

module.exports = mongoose.model('KYC', kycSchema);
