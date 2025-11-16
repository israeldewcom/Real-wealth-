const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const User = require('../models/User');
const logger = require('../utils/logger');

// @desc    Enable 2FA
// @route   POST /api/2fa/enable
// @access  Private
exports.enable2FA = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.two_factor_enabled) {
      return res.status(400).json({
        success: false,
        message: '2FA is already enabled'
      });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Raw Wealthy (${user.email})`,
      issuer: 'Raw Wealthy'
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    // Save secret to user (temporarily)
    user.two_factor_secret = secret.base32;
    await user.save();

    res.json({
      success: true,
      message: '2FA setup initiated',
      data: {
        secret: secret.base32,
        qrCode: qrCode,
        otpauth_url: secret.otpauth_url
      }
    });

  } catch (error) {
    logger.error('Enable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while enabling 2FA'
    });
  }
};

// @desc    Verify 2FA setup
// @route   POST /api/2fa/verify
// @access  Private
exports.verify2FA = async (req, res) => {
  try {
    const { token } = req.body;

    const user = await User.findById(req.user.id).select('+two_factor_secret');

    if (!user.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: '2FA setup not initiated'
      });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Enable 2FA
    user.two_factor_enabled = true;
    await user.save();

    res.json({
      success: true,
      message: '2FA enabled successfully'
    });

  } catch (error) {
    logger.error('Verify 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while verifying 2FA'
    });
  }
};

// @desc    Disable 2FA
// @route   POST /api/2fa/disable
// @access  Private
exports.disable2FA = async (req, res) => {
  try {
    const { token } = req.body;

    const user = await User.findById(req.user.id).select('+two_factor_secret');

    if (!user.two_factor_enabled) {
      return res.status(400).json({
        success: false,
        message: '2FA is not enabled'
      });
    }

    // Verify token before disabling
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Disable 2FA
    user.two_factor_enabled = false;
    user.two_factor_secret = undefined;
    await user.save();

    res.json({
      success: true,
      message: '2FA disabled successfully'
    });

  } catch (error) {
    logger.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while disabling 2FA'
    });
  }
};

// @desc    Verify 2FA token for login
// @route   POST /api/2fa/verify-login
// @access  Public
exports.verifyLogin2FA = async (req, res) => {
  try {
    const { email, token } = req.body;

    const user = await User.findOne({ email }).select('+two_factor_secret');

    if (!user || !user.two_factor_enabled) {
      return res.status(400).json({
        success: false,
        message: '2FA not enabled for this user'
      });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    res.json({
      success: true,
      message: '2FA verification successful'
    });

  } catch (error) {
    logger.error('Verify login 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during 2FA verification'
    });
  }
};
