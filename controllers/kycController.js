const KYC = require('../models/KYC');
const User = require('../models/User');
const logger = require('../utils/logger');

// @desc    Submit KYC application
// @route   POST /api/kyc
// @access  Private
exports.submitKYC = async (req, res) => {
  try {
    const { id_type, id_number, id_front, id_back, selfie_with_id } = req.body;

    // Check if user already has a KYC application
    const existingKYC = await KYC.findOne({ user: req.user.id });
    if (existingKYC && existingKYC.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'You already have a KYC application in progress'
      });
    }

    // Create KYC application
    const kyc = await KYC.create({
      user: req.user.id,
      id_type,
      id_number,
      id_front,
      id_back,
      selfie_with_id,
      status: 'pending'
    });

    // Update user KYC status
    await User.findByIdAndUpdate(req.user.id, {
      kyc_status: 'pending'
    });

    // Notify admin via Socket.IO
    const io = req.app.get('io');
    io.to('admin-room').emit('new-kyc', {
      message: 'New KYC application submitted',
      kycId: kyc._id,
      userId: req.user.id,
      userName: req.user.full_name,
      idType: id_type
    });

    res.status(201).json({
      success: true,
      message: 'KYC application submitted successfully. Waiting for verification.',
      data: { kyc }
    });

  } catch (error) {
    logger.error('Submit KYC error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while submitting KYC'
    });
  }
};

// @desc    Get KYC status
// @route   GET /api/kyc/status
// @access  Private
exports.getKYCStatus = async (req, res) => {
  try {
    const kyc = await KYC.findOne({ user: req.user.id })
      .sort({ createdAt: -1 });

    if (!kyc) {
      return res.json({
        success: true,
        data: {
          status: 'not_submitted',
          message: 'No KYC application found'
        }
      });
    }

    res.json({
      success: true,
      data: { kyc }
    });
  } catch (error) {
    logger.error('Get KYC status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching KYC status'
    });
  }
};

// @desc    Get all KYC applications (Admin)
// @route   GET /api/kyc/applications
// @access  Private/Admin
exports.getKYCApplications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = {};
    if (status) query.status = status;

    const applications = await KYC.find(query)
      .populate('user', 'full_name email phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await KYC.countDocuments(query);

    res.json({
      success: true,
      data: {
        applications,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total
      }
    });
  } catch (error) {
    logger.error('Get KYC applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching KYC applications'
    });
  }
};

// @desc    Approve/Reject KYC application (Admin)
// @route   PUT /api/kyc/:id/status
// @access  Private/Admin
exports.updateKYCStatus = async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;

    const kyc = await KYC.findById(req.params.id).populate('user');
    if (!kyc) {
      return res.status(404).json({
        success: false,
        message: 'KYC application not found'
      });
    }

    kyc.status = status;
    if (status === 'rejected') {
      kyc.rejection_reason = rejection_reason;
    } else if (status === 'approved') {
      kyc.verified_at = new Date();
    }

    await kyc.save();

    // Update user KYC status
    await User.findByIdAndUpdate(kyc.user._id, {
      kyc_verified: status === 'approved',
      kyc_status: status
    });

    // Notify user via Socket.IO
    const io = req.app.get('io');
    io.to(`user-${kyc.user._id}`).emit('kyc-status-updated', {
      message: `Your KYC application has been ${status}`,
      status: status,
      rejectionReason: rejection_reason
    });

    res.json({
      success: true,
      message: `KYC application ${status} successfully`,
      data: { kyc }
    });
  } catch (error) {
    logger.error('Update KYC status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating KYC status'
    });
  }
};
