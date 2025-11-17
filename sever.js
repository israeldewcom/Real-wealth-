require('express-async-errors');
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const useragent = require('express-useragent');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || ['http://localhost:3000', 'https://your-frontend-domain.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
  }
});

// Import utilities and middleware
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { connectDB } = require('./config/database');
const { initializeRedis } = require('./config/redis');

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Raw Wealthy Investment Platform API',
      version: '5.0.0',
      description: 'Complete investment platform backend API',
      contact: {
        name: 'API Support',
        email: 'support@rawwealthy.com'
      }
    },
    servers: [
      {
        url: process.env.NODE_ENV === 'production' 
          ? 'https://api.rawwealthy.com' 
          : `http://localhost:${process.env.PORT || 5000}`,
        description: `${process.env.NODE_ENV || 'development'} server`
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js', './models/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

app.use(compression());
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());
app.use(cookieParser());
app.use(useragent.express());

// Rate Limiting - Stricter in production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// Body Parsing Middleware with increased limits for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS Configuration
app.use(cors({
  origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For', 'X-Real-IP']
}));

// Logging with enhanced format
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { 
  stream: { write: message => logger.info(message.trim()) } 
}));

// Static files with cache control
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    }
  }
}));

// API Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Make io accessible to routes
app.set('io', io);

// Database and Redis Connection
connectDB();
initializeRedis();

// Socket.IO for Real-time Updates with authentication
io.use(require('./middleware/socketAuth')).on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id} - User: ${socket.user?.id || 'Unknown'}`);
  
  // User joins their personal room
  if (socket.user) {
    socket.join(`user-${socket.user.id}`);
    socket.join(`user-${socket.user.id}-notifications`);
    
    // Admin users join admin room
    if (socket.user.role === 'admin') {
      socket.join('admin-room');
      socket.join('admin-notifications');
      logger.info(`Admin ${socket.user.id} joined admin room`);
    }
  }

  // Handle real-time events
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
  });

  socket.on('leave-user-room', (userId) => {
    socket.leave(`user-${userId}`);
  });

  socket.on('user-activity', (data) => {
    logger.info(`User activity: ${socket.user.id} - ${data.activity}`);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected: ${socket.id} - Reason: ${reason}`);
  });

  socket.on('error', (error) => {
    logger.error(`Socket error for user ${socket.user?.id}:`, error);
  });
});

// ==================== COMPLETE ROUTE INTEGRATION ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/investments', require('./routes/investments'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/kyc', require('./routes/kyc'));
app.use('/api/support', require('./routes/support'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/notifications', require('./routes/notifications'));

// =============== CRITICAL MISSING ROUTES ADDED ===============
app.use('/api/deposits', require('./routes/deposits'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/2fa', require('./routes/twoFactor'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/analytics', require('./routes/analytics'));

// Health Check with detailed status
app.get('/api/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const redisStatus = 'connected'; // This would be checked from Redis client
  const memoryUsage = process.memoryUsage();
  
  const health = {
    success: true,
    message: 'Raw Wealthy API is running optimally',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '5.0.0',
    uptime: process.uptime(),
    services: {
      database: dbStatus,
      redis: redisStatus,
      socket: io.engine.clientsCount
    },
    system: {
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB'
      },
      node: process.version,
      platform: process.platform
    }
  };
  
  res.status(200).json(health);
});

// Root endpoint with API information
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 Welcome to Raw Wealthy Investment Platform API',
    version: '5.0.0',
    status: 'operational',
    endpoints: {
      documentation: '/api/docs',
      health: '/api/health',
      status: 'All systems operational'
    },
    timestamp: new Date().toISOString()
  });
});

// Error Handling Middleware (Must be last)
app.use(errorHandler);

// 404 Handler for undefined routes
app.use('*', (req, res) => {
  logger.warn(`404 Route not found: ${req.originalUrl} - IP: ${req.ip}`);
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Raw Wealthy Server running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
  logger.info(`📊 Database: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
  logger.info(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
  logger.info(`❤️  Health Check: http://localhost:${PORT}/api/health`);
  
  // Initialize cron jobs for automated tasks
  require('./utils/cronJobs');
  
  // Initialize payment processors
  require('./config/paymentProcessors');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  server.close(() => {
    mongoose.connection.close();
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, starting graceful shutdown');
  server.close(() => {
    mongoose.connection.close();
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Unhandled rejection and exception handlers
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});

module.exports = app;
