module.exports = {
  apps: [{
    name: 'raw-wealthy-backend',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Auto-restart strategies
    autorestart: true,
    max_memory_restart: '1G',
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Monitoring
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
