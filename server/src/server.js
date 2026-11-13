/**
 * SB Manager Express Application Server
 * Strictly conforms to SB Manager Rebuild Blueprint v2.1 Section 14 and Phase 4 Architecture Plan Sections 4.2, 4.3, 6.1.
 * 
 * Production Invariants:
 * - Production bootstrap fails closed before accepting traffic if JWT signing or Redis configuration is missing.
 * - Verifies live Redis readiness via ping before opening HTTP listener.
 * - Injects validated RefreshTokenService into auth session routes.
 * - Retires legacy routes (/api/v1/sync, /api/v1/admin/stats) with HTTP 410 Gone.
 * - Provides graceful shutdown closing HTTP server, Redis connection, and MongoDB connection.
 */

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createAuthSessionRouter } from './routes/authSessionRoutes.js';
import { RefreshTokenService, MongooseRefreshTokenStore } from './services/refreshTokenService.js';
import {
  RedisReplayCacheService,
  InMemoryReplayCacheService,
  ConfigurationError,
  sanitizeErrorMessage,
  redactSensitiveUrl
} from './services/replayCacheService.js';

export const PORT = process.env.PORT || 3000;
export const MONGO_URI = process.env.NODE_ENV === 'production'
  ? process.env.MONGO_URI
  : (process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/msme_ledger');

/**
 * HTTP 410 Gone handler for retired legacy v1 routes.
 * Strictly conforms to Phase 4 Architecture Plan route retirement contract.
 */
export function legacyRetiredRouteHandler(req, res) {
  return res.status(410).json({
    success: false,
    error: 'ENDPOINT_RETIRED_GONE',
    message: `The legacy API endpoint '${req.originalUrl || req.url}' has been permanently retired and is no longer available. Please migrate to the v2 API specification.`,
    deprecatedAt: 'Phase 4',
    migrationGuide: '/docs/engineering/PHASE_4_ARCHITECTURE_IMPLEMENTATION_PLAN.md'
  });
}

/**
 * Initializes and validates all production services and infrastructure dependencies.
 * Fails closed before accepting any HTTP traffic if secrets or infrastructure are missing.
 * 
 * @param {Object} [options]
 * @returns {Promise<{ tokenService: RefreshTokenService, replayCache: RedisReplayCacheService|InMemoryReplayCacheService }>}
 */
export async function initializeProductionServices(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. JWT Signing Configuration Validation
  const signingKey = options.signingKey || process.env.JWT_PRIVATE_KEY;
  const kid = options.kid || process.env.JWT_KEY_ID;

  if (isProduction) {
    if (!signingKey) {
      throw new ConfigurationError(
        'MISSING_JWT_PRIVATE_KEY',
        'Production startup failed: JWT_PRIVATE_KEY must be explicitly configured.'
      );
    }
    if (!kid) {
      throw new ConfigurationError(
        'MISSING_JWT_KEY_ID',
        'Production startup failed: JWT_KEY_ID must be explicitly configured.'
      );
    }
  }

  // 3. Replay Cache Resolution & Connectivity Verification
  let replayCache;
  if (isProduction) {
    if (options.replayCache) {
      // In production, reject InMemoryReplayCacheService or arbitrary adapters
      if (!(options.replayCache instanceof RedisReplayCacheService)) {
        throw new ConfigurationError(
          'INVALID_PRODUCTION_REPLAY_CACHE',
          'Production startup failed: An approved RedisReplayCacheService is required in production.'
        );
      }
      replayCache = options.replayCache;
    } else {
      const redisUrl = options.redisUrl || process.env.REDIS_URL;
      const redisSecret = options.replayCacheSecret || process.env.REPLAY_CACHE_SECRET;

      if (!redisUrl) {
        throw new ConfigurationError(
          'MISSING_REDIS_URL',
          'Production startup failed: REDIS_URL must be explicitly configured for shared replay cache.'
        );
      }
      if (!redisSecret) {
        throw new ConfigurationError(
          'MISSING_REPLAY_CACHE_SECRET',
          'Production startup failed: REPLAY_CACHE_SECRET must be explicitly configured.'
        );
      }

      replayCache = new RedisReplayCacheService({
        redisUrl,
        secret: redisSecret,
        redisClient: options.redisClient
      });
    }

    // In production, always perform live connectivity check (even if injected)
    try {
      await replayCache.ping();
    } catch (redisErr) {
      throw new ConfigurationError(
        'REDIS_READINESS_FAILED',
        `Production startup failed: Unable to establish live connectivity to Redis. Details: ${sanitizeErrorMessage(redisErr.message)}`
      );
    }
  } else {
    // Non-production fallback (development / tests)
    if (options.replayCache) {
      replayCache = options.replayCache;
    } else if (options.redisClient || options.redisUrl || process.env.REDIS_URL) {
      replayCache = new RedisReplayCacheService(options);
      try {
        await replayCache.ping();
      } catch (err) {
        throw new ConfigurationError(
          'REDIS_READINESS_FAILED',
          `Redis connection failed: ${sanitizeErrorMessage(err.message)}`
        );
      }
    } else {
      replayCache = new InMemoryReplayCacheService(options);
    }
  }

  // 4. RefreshTokenStore & Service Construction with Real Store and Injected Cache
  let store;
  if (isProduction) {
    if (options.store) {
      if (!(options.store instanceof MongooseRefreshTokenStore)) {
        throw new ConfigurationError(
          'INVALID_PRODUCTION_TOKEN_STORE',
          'Production startup failed: An approved persistent MongooseRefreshTokenStore is required in production.'
        );
      }
      store = options.store;
    } else {
      store = new MongooseRefreshTokenStore();
    }
  } else {
    store = options.store || new MongooseRefreshTokenStore();
  }

  const tokenService = new RefreshTokenService({
    store,
    replayCache,
    signingKey,
    kid,
    allowTestKeyFallback: !isProduction
  });

  return { tokenService, replayCache };
}

/**
 * Builds the Express application with configured middleware and explicitly injected services.
 * 
 * @param {Object} options
 * @param {RefreshTokenService} options.tokenService
 * @param {Object} [options.csrfMiddleware]
 * @returns {import('express').Application}
 */
export function createApp(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!options.tokenService && isProduction) {
    throw new ConfigurationError(
      'MISSING_TOKEN_SERVICE',
      'Cannot mount production application without an explicitly configured tokenService.'
    );
  }

  const app = express();

  // Standard Middleware
  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  // Mount Auth Session Router with explicitly injected service
  const authRouter = createAuthSessionRouter({
    tokenService: options.tokenService,
    csrfMiddleware: options.csrfMiddleware
  });
  app.use('/api/v2/auth', authRouter);

  // Retire Legacy Routes: Return HTTP 410 Gone for all HTTP methods
  app.all('/api/v1/sync', legacyRetiredRouteHandler);
  app.all('/api/v1/admin/stats', legacyRetiredRouteHandler);

  return app;
}

/**
 * Starts the application server with database connection and readiness checks.
 * 
 * @param {Object} [options]
 * @returns {Promise<{ app: import('express').Application, server: any, tokenService: any, replayCache: any, shutdown: Function }>}
 */
export async function startServer(options = {}) {
  const isProduction = process.env.NODE_ENV === 'production';
  const { tokenService, replayCache } = await initializeProductionServices(options);
  const app = createApp({ ...options, tokenService });

  const mongoUri = options.mongoUri || process.env.MONGO_URI || (!isProduction ? 'mongodb://127.0.0.1:27017/msme_ledger' : null);
  if (isProduction && (!mongoUri || !mongoUri.trim())) {
    throw new ConfigurationError(
      'MISSING_MONGO_URI',
      'Production startup failed: MONGO_URI must be explicitly configured.'
    );
  }

  try {
    await mongoose.connect(mongoUri);
  } catch (mongoErr) {
    throw new ConfigurationError(
      'MONGO_CONNECTION_FAILED',
      `Production startup failed: Unable to connect to MongoDB. Details: ${sanitizeErrorMessage(mongoErr.message)}`
    );
  }

  const port = options.port || PORT;
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.on('error', reject);
  });

  const shutdown = async () => {
    if (server) {
      await new Promise(r => server.close(r));
    }
    if (replayCache) {
      await replayCache.close();
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  };

  return { app, server, tokenService, replayCache, shutdown };
}

// Auto-start server in standalone execution mode
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer()
    .then(() => {
      console.log(`SB Manager server is running on http://localhost:${PORT}`);
    })
    .catch((error) => {
      console.error('Server failed to start:', sanitizeErrorMessage(error.message));
      process.exit(1);
    });
}
