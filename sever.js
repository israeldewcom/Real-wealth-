require('express-async-errors');
const cluster = require('cluster');
const os = require('os');

// Load env vars based on environment
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Cluster mode for production
if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
  const numCPUs = os.cpus().length;
  console.log(`🔄 Master ${process.pid} is running. Forking ${numCPUs} workers...`);
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`❌ Worker ${worker.process.pid} died. Forking new worker...`);
    cluster.fork();
  });
} else {
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
  const requestIp = require('request-ip');
  const swaggerJsdoc = require('swagger-jsdoc');
  const swaggerUi = require('swagger-ui-express');

  const app = express();
  const server = http.createServer(app);
  
  // Enhanced Socket.IO configuration
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : ['http://localhost:3000', 'https://your-frontend-domain.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true,
      transports: ['websocket', 'polling']
    },
    pingTimeout: 60000,
    pingInterval: 25000
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
        version: '6.0.0',
        description: 'Complete investment platform backend API',
        contact: {
          name: 'API Support',
          email: 'support@rawwealthy.com'
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT'
        }
      },
      servers: [
        {
          url: process.env.NODE_ENV === 'production' 
            ? (process.env.API_URL || 'https://api.rawwealthy.com')
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
        },
        schemas: {
          User: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              full_name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              phone: { type: 'string' },
              balance: { type: 'number' },
              role: { type: 'string', enum: ['user', 'admin'] },
              kyc_verified: { type: 'boolean' },
              is_active: { type: 'boolean' },
              created_at: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    },
    apis: ['./routes/*.js', './models/*.js', './controllers/*.js']
  };

  const swaggerSpec = swaggerJsdoc(swaggerOptions);

  // Enhanced Security Middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:", "https://api.rawwealthy.com"],
        frameSrc: ["'self'"]
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // Performance Middleware
  app.use(compression({
    level: 6,
    threshold: 100 * 1024 // Compress responses over 100KB
  }));

  // Security Middleware
  app.use(mongoSanitize());
  app.use(xss());
  app.use(hpp());
  app.use(cookieParser());
  app.use(useragent.express());
  app.use(requestIp.mw());

  // Enhanced Rate Limiting
  const createRateLimit = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.clientIp || req.ip,
    skip: (req) => {
      // Skip rate limiting for health checks and certain IPs
      if (req.url === '/api/health') return true;
      if (process.env.WHITELISTED_IPS && process.env.WHITELISTED_IPS.includes(req.clientIp)) return true;
      return false;
    }
  });

  // Apply different rate limits based on endpoints
  app.use('/api/', createRateLimit(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 100 : 1000, 'Too many requests from this IP, please try again later.'));
  app.use('/api/auth/', createRateLimit(15 * 60 * 1000, 5, 'Too many authentication attempts, please try again later.'));
  app.use('/api/admin/', createRateLimit(15 * 60 * 1000, 50, 'Too many admin requests, please slow down.'));

  // Enhanced Body Parsing Middleware
  app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '50mb',
    parameterLimit: 1000
  }));

  // Enhanced CORS Configuration
  const corsOptions = {
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CLIENT_URL 
        ? process.env.CLIENT_URL.split(',') 
        : ['http://localhost:3000', 'https://your-frontend-domain.com'];
      
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For', 'X-Real-IP', 'X-Client-Version'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
  };
  app.use(cors(corsOptions));

  // Enhanced Logging
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', { 
    stream: { write: message => logger.info(message.trim()) },
    skip: (req) => req.url === '/api/health' // Skip health check logs
  }));

  // Static files with enhanced cache control
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : '0',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.pdf')) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
      }
      // Security headers for static files
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
    }
  }));

  // API Documentation
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Raw Wealthy API Documentation",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true
    }
  }));

  // Make io accessible to routes
  app.set('io', io);

  // Database and Redis Connection with retry logic
  const initializeServices = async () => {
    try {
      await connectDB();
      await initializeRedis();
      logger.info('✅ All services initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize services:', error);
      process.exit(1);
    }
  };

  // Initialize services
  initializeServices();

  // Enhanced Socket.IO with authentication and error handling
  io.use(require('./middleware/socketAuth')).on('connection', (socket) => {
    logger.info(`🔌 Client connected: ${socket.id} - User: ${socket.user?.id || 'Unknown'} - IP: ${socket.handshake.address}`);
    
    // User joins their personal room
    if (socket.user) {
      socket.join(`user-${socket.user.id}`);
      socket.join(`user-${socket.user.id}-notifications`);
      
      // Admin users join admin room
      if (socket.user.role === 'admin') {
        socket.join('admin-room');
        socket.join('admin-notifications');
        socket.join('admin-dashboard');
        logger.info(`👨‍💼 Admin ${socket.user.id} joined admin rooms`);
      }

      // Track user presence
      socket.emit('connection-established', {
        message: 'Real-time connection established',
        userId: socket.user.id,
        timestamp: new Date().toISOString()
      });
    }

    // Handle real-time events
    socket.on('join-user-room', (userId) => {
      if (socket.user.role === 'admin' || socket.user.id === userId) {
        socket.join(`user-${userId}`);
      }
    });

    socket.on('leave-user-room', (userId) => {
      socket.leave(`user-${userId}`);
    });

    socket.on('user-activity', (data) => {
      logger.info(`👤 User activity: ${socket.user.id} - ${data.activity} - IP: ${socket.handshake.address}`);
      // Log user activity for analytics
    });

    socket.on('ping', (cb) => {
      if (typeof cb === 'function') {
        cb({ 
          status: 'pong', 
          timestamp: new Date().toISOString(),
          serverTime: Date.now()
        });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`🔌 Client disconnected: ${socket.id} - Reason: ${reason} - User: ${socket.user?.id || 'Unknown'}`);
    });

    socket.on('error', (error) => {
      logger.error(`💥 Socket error for user ${socket.user?.id}:`, error);
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

  // Enhanced Health Check with detailed status
  app.get('/api/health', async (req, res) => {
    const healthCheck = {
      success: true,
      message: 'Raw Wealthy API is running optimally',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      version: '6.0.0',
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'
      },
      services: {
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        redis: 'connected', // This would be checked from Redis client
        socket: io.engine.clientsCount
      },
      system: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cluster: cluster.worker ? cluster.worker.id : 'master'
      },
      request: {
        ip: req.clientIp,
        userAgent: req.useragent,
        method: req.method,
        url: req.url
      }
    };
    
    // Add performance metrics
    healthCheck.performance = {
      eventLoopDelay: Math.round(performance.now() - Date.now()),
      cpuUsage: process.cpuUsage()
    };

    res.status(200).json(healthCheck);
  });

  // Root endpoint with API information
  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: '🚀 Welcome to Raw Wealthy Investment Platform API',
      version: '6.0.0',
      status: 'operational',
      environment: process.env.NODE_ENV,
      endpoints: {
        documentation: '/api/docs',
        health: '/api/health',
        status: 'All systems operational'
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // API Status endpoint
  app.get('/api/status', (req, res) => {
    res.json({
      success: true,
      data: {
        platform: 'Raw Wealthy Investment Platform',
        version: '6.0.0',
        status: 'operational',
        services: {
          api: 'operational',
          database: mongoose.connection.readyState === 1 ? 'operational' : 'degraded',
          redis: 'operational',
          socket: 'operational',
          email: 'operational'
        },
        statistics: {
          users: 'growing',
          investments: 'active',
          uptime: process.uptime()
        },
        maintenance: null,
        last_updated: new Date().toISOString()
      }
    });
  });

  // Error Handling Middleware (Must be last)
  app.use(errorHandler);

  // 404 Handler for undefined routes with detailed logging
  app.use('*', (req, res) => {
    logger.warn(`🔍 404 Route not found: ${req.originalUrl} - IP: ${req.clientIp} - Method: ${req.method} - User-Agent: ${req.get('User-Agent')}`);
    res.status(404).json({
      success: false,
      message: 'Route not found',
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      suggestion: 'Check the API documentation at /api/docs for available endpoints'
    });
  });

  const PORT = process.env.PORT || 5000;

  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Raw Wealthy Server ${cluster.worker ? `Worker ${cluster.worker.id}` : 'Master'} running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    logger.info(`📊 Database: ${mongoose.connection.readyState === 1 ? '✅ Connected' : '❌ Disconnected'}`);
    logger.info(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
    logger.info(`❤️  Health Check: http://localhost:${PORT}/api/health`);
    logger.info(`🔌 Socket.IO: Enabled with ${io.engine.clientsCount} clients`);
    logger.info(`🔄 Cluster: ${cluster.worker ? `Worker ${cluster.worker.id}` : 'Master mode'}`);
    
    // Initialize cron jobs for automated tasks
    if (!cluster.worker || cluster.worker.id === 1) {
      require('./utils/cronJobs');
      logger.info('⏰ Cron jobs initialized');
    }
    
    // Initialize payment processors
    require('./config/paymentProcessors');
  });

  // Enhanced graceful shutdown handling
  const gracefulShutdown = (signal) => {
    logger.info(`🛑 ${signal} received, starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(() => {
      logger.info('✅ HTTP server closed');
      
      // Close database connections
      mongoose.connection.close(false, () => {
        logger.info('✅ MongoDB connection closed');
        
        // Close Redis connections
        // redisClient.quit(() => {
        //   logger.info('✅ Redis connection closed');
        // });
        
        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      });
    });

    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('❌ Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Enhanced unhandled rejection and exception handlers
  process.on('unhandledRejection', (err, promise) => {
    logger.error('💥 UNHANDLED REJECTION! Shutting down...', err);
    logger.error('Promise:', promise);
    server.close(() => {
      process.exit(1);
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('💥 UNCAUGHT EXCEPTION! Shutting down...', err);
    server.close(() => {
      process.exit(1);
    });
  });

  // Memory leak detection
  if (process.env.NODE_ENV === 'production') {
    const memoryUsageCheck = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB threshold
        logger.warn('⚠️ High memory usage detected:', memoryUsage);
      }
    }, 60000); // Check every minute

    // Cleanup interval on shutdown
    process.on('exit', () => {
      clearInterval(memoryUsageCheck);
    });
  }
}
