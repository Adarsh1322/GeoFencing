import http from 'http';
import { createApp } from './app.js';
import { closePool } from './config/database.js';
import { env } from './config/environment.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outboxWorker.js';
import { initSocketServer } from './sockets/socketServer.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);

// Initialize Socket.IO
const io = initSocketServer(server);

// Start background notification outbox worker
startOutboxWorker();

server.listen(env.PORT, () => {
  logger.info(`CampusSafe Backend Server running on port ${env.PORT} in ${env.NODE_ENV} mode.`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  stopOutboxWorker();
  io.close();
  server.close(async () => {
    logger.info('HTTP server closed.');
    await closePool();
    logger.info('Database pool closed. Exiting process.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
