const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/emailService');
const { generateReferralCode } = require('../utils/helpers');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
exports.register = async (req, res) => {
  try {
    const {
      full_name,
      email,
      phone,
      password,
      referral_code,
      risk_tolerance = 'medium',
      investment_strategy = 'balanced'
    } = req.body;

    // Validate required fields
    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this email or phone number'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate referral code for new user
    const userReferralCode = generateReferralCode();

    // Find referrer if referral code provided
    let referredBy = null;
    if (referral_code) {
      const referrer = await User.findOne({ referral_code: referral_code.toUpperCase() });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    // Create user
    const user = await User.create({
      full_name: full_name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password: hashedPassword,
      referral_code: userReferralCode,
      referred_by: referredBy,
      risk_tolerance,
      investment_strategy,
      registration_ip: req.ip,
      user_agent: req.useragent.source
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    // Remove password from output
    user.password = undefined;

    // Send welcome email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Welcome to Raw Wealthy Investment Platform',
        template: 'welcome',
        data: {
          name: user.full_name,
          referral_code: user.referral_code
        }
      });
    } catch (emailError) {
      logger.error('Welcome email failed:', emailError);
    }

    // Notify referrer if applicable
    if (referredBy) {
      const io = req.app.get('io');
      io.to(`user-${referredBy}`).emit('new-referral', {
        message: 'New user signed up using your referral code',
        referralName: user.full_name
      });
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        token,
        requires_2fa: false
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check if user exists and select password
    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+password +two_factor_secret +login_attempts +lock_until');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account temporarily locked due to too many failed attempts'
      });
    }

    // Check password
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Check if 2FA is enabled
    if (user.two_factor_enabled) {
      return res.json({
        success: true,
        message: 'Two-factor authentication required',
        requires_2fa: true,
        temp_token: jwt.sign(
          { id: user._id, type: '2fa_verification' },
          process.env.JWT_SECRET,
          { expiresIn: '10m' }
        )
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    // Update last login
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    await user.save();

    // Remove sensitive data
    user.password = undefined;
    user.two_factor_secret = undefined;

    // Emit login event
    const io = req.app.get('io');
    io.to(`user-${user._id}`).emit('user-logged-in', {
      message: 'New login detected',
      device: req.useragent,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        token,
        requires_2fa: false
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

/**
 * @desc    Verify 2FA for login
 * @route   POST /api/auth/verify-2fa
 * @access  Public
 */
exports.verify2FALogin = async (req, res) => {
  try {
    const { temp_token, code } = req.body;

    if (!temp_token || !code) {
      return res.status(400).json({
        success: false,
        message: 'Token and code are required'
      });
    }

    // Verify temp token
    let decoded;
    try {
      decoded = jwt.verify(temp_token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    if (decoded.type !== '2fa_verification') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const user = await User.findById(decoded.id).select('+two_factor_secret');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify 2FA code
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code'
      });
    }

    // Generate final JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    // Update last login
    user.last_login = new Date();
    user.last_login_ip = req.ip;
    await user.save();

    // Remove sensitive data
    user.password = undefined;
    user.two_factor_secret = undefined;

    res.json({
      success: true,
      message: '2FA verification successful',
      data: {
        user,
        token,
        requires_2fa: false
      }
    });

  } catch (error) {
    logger.error('2FA verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during 2FA verification'
    });
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/profile
 * @access  Private
 */
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('referred_by', 'full_name email')
      .select('-password -two_factor_secret');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
exports.updateProfile = async (req, res) => {
  try {
    const { full_name, phone, risk_tolerance, investment_strategy } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        full_name,
        phone,
        risk_tolerance,
        investment_strategy,
        updated_at: new Date()
      },
      { new: true, runValidators: true }
    ).select('-password -two_factor_secret');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
};

/**
 * @desc    Change password
 * @route   PUT /api/auth/password
 * @access  Private
 */
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    // Verify current password
    const isCurrentPasswordCorrect = await user.comparePassword(current_password);
    if (!isCurrentPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(new_password, salt);
    await user.save();

    // Send password change notification email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Changed Successfully',
        template: 'password-changed',
        data: {
          name: user.full_name,
          timestamp: new Date().toLocaleString()
        }
      });
    } catch (emailError) {
      logger.error('Password change email failed:', emailError);
    }

    // Notify user via socket
    const io = req.app.get('io');
    io.to(`user-${user._id}`).emit('password-changed', {
      message: 'Your password was changed successfully',
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while changing password'
    });
  }
};

/**
 * @desc    Forgot password - Send reset email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether email exists
      return res.json({
        success: true,
        message: 'If the email exists, a password reset link has been sent'
      });
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { id: user._id, type: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Save reset token to user (in a real app, you might want to store this in Redis)
    user.password_reset_token = resetToken;
    user.password_reset_expires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    // Send reset email
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    await sendEmail({
      email: user.email,
      subject: 'Reset Your Password - Raw Wealthy',
      template: 'password-reset',
      data: {
        name: user.full_name,
        reset_url: resetUrl,
        expiry_time: '1 hour'
      }
    });

    res.json({
      success: true,
      message: 'If the email exists, a password reset link has been sent'
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing password reset'
    });
  }
};

/**
 * @desc    Reset password with token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    if (decoded.type !== 'password_reset') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    const user = await User.findOne({
      _id: decoded.id,
      password_reset_token: token,
      password_reset_expires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    user.password = await bcrypt.hash(new_password, salt);
    user.password_reset_token = undefined;
    user.password_reset_expires = undefined;
    await user.save();

    // Send confirmation email
    try {
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Successful',
        template: 'password-reset-success',
        data: {
          name: user.full_name,
          timestamp: new Date().toLocaleString()
        }
      });
    } catch (emailError) {
      logger.error('Password reset success email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while resetting password'
    });
  }
};
