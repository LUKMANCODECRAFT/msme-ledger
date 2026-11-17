/**
 * Authentication Service — Stage 4.1C / SBM-040
 * 
 * Implements registration, login, credential verification, rate-limiting,
 * account lockout, constant-time dummy verification, and token issuance.
 * Strictly adheres to Blueprint v2.1 Section 14, Section 23 and Phase 4 Architecture Plan.
 */

import crypto from 'crypto';
import { User, Business, Membership } from '../models/target/coreModels.js';
import { hashPassword, verifyPassword } from './passwordService.js';
import { signAccessToken, generateTestRsaKeyPair } from './jwtService.js';
import { normalizeEmail, isValidEmail } from '../utils/emailNormalization.js';
import { LoginRateLimitService, defaultLoginRateLimitService } from './loginRateLimitService.js';

export class AuthError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.details = details;
  }
}

export class AuthService {
  /**
   * @param {Object} [options]
   * @param {import('mongoose').Model} [options.userModel]
   * @param {import('mongoose').Model} [options.businessModel]
   * @param {import('mongoose').Model} [options.membershipModel]
   * @param {import('./refreshTokenService.js').RefreshTokenService} options.tokenService
   * @param {LoginRateLimitService} [options.rateLimitService]
   * @param {string} [options.signingKey]
   * @param {string} [options.kid]
   * @param {boolean} [options.allowTestKeyFallback=false]
   */
  constructor(options = {}) {
    this.UserModel = options.userModel || User;
    this.BusinessModel = options.businessModel || Business;
    this.MembershipModel = options.membershipModel || Membership;
    this.tokenService = options.tokenService || null;
    this.rateLimiter = options.rateLimitService || defaultLoginRateLimitService;

    const isProduction = process.env.NODE_ENV === 'production';
    this.kid = options.kid || process.env.JWT_KEY_ID;
    this.signingKey = options.signingKey || process.env.JWT_PRIVATE_KEY;

    if (!this.signingKey) {
      if (isProduction || !options.allowTestKeyFallback) {
        throw new Error('MISSING_SIGNING_KEY: AuthService requires an explicit signingKey.');
      }
      const pair = generateTestRsaKeyPair(this.kid || 'auth-service-test-key');
      this.signingKey = pair.privateKey;
      this.kid = pair.kid;
    }

    if (!this.kid) {
      if (isProduction) {
        throw new Error('MISSING_KEY_ID: AuthService requires an explicit kid in production.');
      }
      this.kid = 'auth-service-key-1';
    }
  }

  /**
   * Registers a new merchant user, initializes default business and owner membership,
   * and issues an access JWT alongside a refresh token.
   * 
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @param {string} params.fullName
   * @param {string} [params.businessName]
   * @returns {Promise<{ user: Object, accessToken: string, rawRefreshToken: string }>}
   */
  async register({ email, password, fullName, businessName }) {
    if (!email || !isValidEmail(email)) {
      throw new AuthError('INVALID_EMAIL', 'A valid email address is required.');
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new AuthError('WEAK_PASSWORD', 'Password must be at least 8 characters long.');
    }

    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      throw new AuthError('INVALID_FULL_NAME', 'Full name is required.');
    }

    const normalizedEmail = normalizeEmail(email);

    // Enforce case-insensitive email uniqueness check
    const existing = await this.UserModel.findOne({ email: normalizedEmail });
    if (existing) {
      throw new AuthError('EMAIL_ALREADY_EXISTS', 'An account with this email address already exists.');
    }

    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const businessId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const cleanBusinessName = businessName && typeof businessName === 'string' && businessName.trim()
      ? businessName.trim()
      : `${fullName.trim()}'s Shop`;

    // Persist records
    const businessDoc = new this.BusinessModel({
      id: businessId,
      name: cleanBusinessName,
      type: 'general',
      currency: 'NGN',
      identityStatus: 'verified_claimed'
    });

    const userDoc = new this.UserModel({
      id: userId,
      email: normalizedEmail,
      passwordHash,
      fullName: fullName.trim(),
      defaultBusinessId: businessId,
      sessionVersion: 1,
      failedLoginAttempts: 0,
      lockoutUntil: null
    });

    const membershipDoc = new this.MembershipModel({
      id: membershipId,
      userId,
      businessId,
      role: 'owner'
    });

    await businessDoc.save();
    await userDoc.save();
    await membershipDoc.save();

    // Issue RS256 access token (15 mins)
    const accessToken = signAccessToken(
      {
        sub: userId,
        email: normalizedEmail,
        defaultBusinessId: businessId,
        sessionVersion: 1,
        role: 'owner'
      },
      this.signingKey,
      { kid: this.kid }
    );

    // Issue refresh token if tokenService is present
    let rawRefreshToken = null;
    if (this.tokenService) {
      if (typeof this.tokenService.createInitialSession === 'function') {
        const tokenResult = await this.tokenService.createInitialSession({
          userId,
          email: normalizedEmail,
          defaultBusinessId: businessId,
          sessionVersion: 1,
          role: 'owner'
        });
        rawRefreshToken = tokenResult.refreshToken || tokenResult.rawToken;
      } else if (typeof this.tokenService.createToken === 'function') {
        const tokenResult = await this.tokenService.createToken({
          userId,
          email: normalizedEmail,
          defaultBusinessId: businessId,
          sessionVersion: 1
        });
        rawRefreshToken = tokenResult.rawToken || tokenResult.refreshToken;
      }
    }

    return {
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: fullName.trim(),
        defaultBusinessId: businessId
      },
      accessToken,
      rawRefreshToken
    };
  }

  /**
   * Authenticates user credentials with IP rate-limiting, constant-time dummy verification,
   * account lockout enforcement, and session issuance.
   * 
   * @param {Object} params
   * @param {string} params.email
   * @param {string} params.password
   * @param {string} [params.ip]
   * @returns {Promise<{ user: Object, accessToken: string, rawRefreshToken: string }>}
   */
  async login({ email, password, ip }) {
    // 1. IP rate limiting (5 attempts / min)
    await this.rateLimiter.checkIpRateLimit(ip);

    if (!email || !password) {
      throw new AuthError('INVALID_CREDENTIALS', 'Email and password are required.');
    }

    const normalizedEmail = normalizeEmail(email);
    const user = await this.UserModel.findOne({ email: normalizedEmail });

    // 2. Constant-time dummy verification if user is not found
    if (!user) {
      await this.rateLimiter.performDummyVerification(password);
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // 3. Check account lockout status
    if (this.rateLimiter.isAccountLocked(user)) {
      throw new AuthError(
        'ACCOUNT_LOCKED',
        'Account is locked due to too many failed login attempts. Please try again later.',
        { lockoutUntil: user.lockoutUntil }
      );
    }

    // 4. Verify password
    const isPasswordValid = await verifyPassword(user.passwordHash, password);
    if (!isPasswordValid) {
      const lockOutcome = await this.rateLimiter.recordFailedAttempt(user);
      if (lockOutcome.isLocked) {
        throw new AuthError(
          'ACCOUNT_LOCKED',
          'Account is locked due to 10 consecutive failed login attempts. Please try again later.',
          { lockoutUntil: lockOutcome.lockoutUntil }
        );
      }
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // 5. Successful authentication — reset failed counter
    await this.rateLimiter.resetFailedAttempts(user);

    // Issue access token
    const accessToken = signAccessToken(
      {
        sub: user.id,
        email: user.email,
        defaultBusinessId: user.defaultBusinessId || null,
        sessionVersion: user.sessionVersion || 1,
        role: 'owner'
      },
      this.signingKey,
      { kid: this.kid }
    );

    // Issue refresh token
    let rawRefreshToken = null;
    if (this.tokenService) {
      if (typeof this.tokenService.createInitialSession === 'function') {
        const tokenResult = await this.tokenService.createInitialSession({
          userId: user.id,
          email: user.email,
          defaultBusinessId: user.defaultBusinessId,
          sessionVersion: user.sessionVersion || 1,
          role: 'owner',
          ipAddress: ip
        });
        rawRefreshToken = tokenResult.refreshToken || tokenResult.rawToken;
      } else if (typeof this.tokenService.createToken === 'function') {
        const tokenResult = await this.tokenService.createToken({
          userId: user.id,
          email: user.email,
          defaultBusinessId: user.defaultBusinessId,
          sessionVersion: user.sessionVersion || 1
        });
        rawRefreshToken = tokenResult.rawToken || tokenResult.refreshToken;
      }
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        defaultBusinessId: user.defaultBusinessId
      },
      accessToken,
      rawRefreshToken
    };
  }

  /**
   * Retrieves verified user profile, active memberships, and registered businesses.
   * 
   * @param {string} userId
   * @returns {Promise<{ user: Object, memberships: Array, businesses: Array }>}
   */
  async getMe(userId) {
    if (!userId) {
      throw new AuthError('UNAUTHORIZED', 'User identity required.');
    }

    const user = await this.UserModel.findOne({ id: userId });
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User profile not found.');
    }

    const memberships = await this.MembershipModel.find({ userId });
    const businessIds = memberships.map(m => m.businessId);
    const businesses = await this.BusinessModel.find({ id: { $in: businessIds } });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        defaultBusinessId: user.defaultBusinessId,
        sessionVersion: user.sessionVersion || 1
      },
      memberships,
      businesses
    };
  }
}
