const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const { rateLimit } = require('../utils/rateLimiter');

/**
 * Enhanced Authentication Middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object  
 * @param {Function} next - Express next function
 */
exports.auth = async (req, res, next) => {
  try {
    let token;

    // Extract token from various sources
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.query?.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided.',
        code: 'NO_TOKEN'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if user still exists and is active
      const user = await User.findById(decoded.id)
        .select('-password -two_factor_secret')
        .populate('referred_by', 'full_name email');
        
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User no longer exists.',
          code: 'USER_NOT_FOUND'
        });
      }

      // Check if user account is active
      if (!user.is_active) {
        return res.status(401).json({
          success: false,
          message: 'Account has been suspended. Please contact support.',
          code: 'ACCOUNT_SUSPENDED'
        });
      }

      // Check if password was changed after token was issued
      if (user.password_changed_at && decoded.iat < user.password_changed_at.getTime() / 1000) {
        return res.status(401).json({
          success: false,
          message: 'Password was recently changed. Please login again.',
          code: 'PASSWORD_CHANGED'
        });
      }

      // Add user to request object
      req.user = user;
      
      // Log authentication success (without sensitive data)
      logger.info(`🔐 User authenticated: ${user._id} - ${user.email} - IP: ${req.clientIp}`);
      
      next();
    } catch (jwtError) {
      // Enhanced JWT error handling
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please login again.',
          code: 'INVALID_TOKEN'
        });
      } else {
        logger.error('JWT verification error:', jwtError);
        throw jwtError;
      }
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Admin Authorization Middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
exports.admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    logger.info(`👨‍💼 Admin access: ${req.user._id} - ${req.user.email}`);
    next();
  } else {
    logger.warn(`🚫 Admin access denied for user: ${req.user?._id} - IP: ${req.clientIp}`);
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.',
      code: 'ADMIN_REQUIRED'
    });
  }
};

/**
 * Optional Authentication Middleware
 * Continues even if no token provided
 */
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.token) {
      token = req.cookies.token;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id)
          .select('-password -two_factor_secret')
          .populate('referred_by', 'full_name email');
          
        if (user && user.is_active) {
          req.user = user;
        }
      } catch (jwtError) {
        // Silently continue without user for optional auth
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

/**
 * Socket.IO Authentication Middleware
 * @param {Object} socket - Socket.IO socket object
 * @param {Function} next - Socket.IO next function
 */
exports.socketAuth = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || 
                  socket.handshake.headers.token ||
                  socket.handshake.query.token;
    
    if (!token) {
      logger.warn(`🚫 Socket connection rejected: No token provided - IP: ${socket.handshake.address}`);
      return next(new Error('Authentication error: No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('-password')
      .lean();
    
    if (!user) {
      logger.warn(`🚫 Socket connection rejected: User not found - IP: ${socket.handshake.address}`);
      return next(new Error('Authentication error: User not found'));
    }

    if (!user.is_active) {
      logger.warn(`🚫 Socket connection rejected: Account suspended - User: ${user._id} - IP: ${socket.handshake.address}`);
      return next(new Error('Authentication error: Account suspended'));
    }

    // Add user to socket object
    socket.user = user;
    
    logger.info(`🔌 Socket authenticated: ${socket.id} - User: ${user._id} - IP: ${socket.handshake.address}`);
    next();
  } catch (error) {
    logger.error(`🚫 Socket authentication error: ${error.message} - IP: ${socket.handshake.address}`);
    
    if (error.name === 'TokenExpiredError') {
      return next(new Error('Authentication error: Token expired'));
    } else if (error.name === 'JsonWebTokenError') {
      return next(new Error('Authentication error: Invalid token'));
    } else {
      return next(new Error('Authentication error: Invalid token'));
    }
  }
};

/**
 * Rate Limiting Middleware for Specific Endpoints
 */
exports.loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
    code: 'RATE_LIMITED'
  },
  keyGenerator: (req) => req.clientIp,
  skipSuccessfulRequests: true
});

exports.apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
    code: 'RATE_LIMITED'
  },
  keyGenerator: (req) => req.clientIp
});
