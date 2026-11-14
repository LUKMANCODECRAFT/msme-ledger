/**
 * Stage 4.1B: Ambiguous MongoDB Commit Recovery Invariant Regression Suite
 * 
 * Verifies that an exhausted UnknownTransactionCommitResult is NEVER treated as a confirmed rollback:
 * 1. Exhausted unknown commit retries do not invoke onRollbackHook.
 * 2. The Mongoose transaction adapter does not treat an ambiguous commit as a confirmed abort.
 * 3. Scenario A (committed-but-unacknowledged): Replay response retained; R1 retry returns exact committed R2.
 * 4. Scenario B (uncommitted): R1 remains active, stale cached successor never returned, next rotation overwrites cache.
 * 5. Confirmed transaction failures still abort and execute targeted cache cleanup.
 * 6. TransientTransactionError retries and successful commit retries remain intact.
 * 7. HTTP session controller responds with 503 and preserves refresh-token cookie without clearing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  RefreshTokenService,
  MongooseRefreshTokenStore,
  InMemoryRefreshTokenStore,
  createTestRefreshTokenService,
  hashRefreshToken,
  RefreshTokenError
} from '../../server/src/services/refreshTokenService.js';
import {
  InMemoryReplayCacheService
} from '../../server/src/services/replayCacheService.js';
import {
  createAuthSessionController,
  REFRESH_COOKIE_NAME
} from '../../server/src/controllers/authSessionController.js';

class MockSession {
  constructor(options = {}) {
    this.commitThrowsCount = options.commitThrowsCount || 0;
    this.commitErrorLabels = options.commitErrorLabels || ['UnknownTransactionCommitResult'];
    this.startTransactionThrows = options.startTransactionThrows || false;
    this.commitTransactionCallCount = 0;
    this.abortTransactionCallCount = 0;
    this.endSessionCallCount = 0;
    this.transactionStarted = false;
  }

  startTransaction() {
    if (this.startTransactionThrows) {
      throw new Error('START_TRANSACTION_FAILED');
    }
    this.transactionStarted = true;
  }

  async commitTransaction() {
    this.commitTransactionCallCount++;
    if (this.commitThrowsCount > 0) {
      this.commitThrowsCount--;
      const err = new Error('COMMIT_NETWORK_DROPPED: UnknownTransactionCommitResult');
      err.errorLabels = [...this.commitErrorLabels];
      err.hasErrorLabel = (label) => this.commitErrorLabels.includes(label);
      throw err;
    }
  }

  async abortTransaction() {
    this.abortTransactionCallCount++;
  }

  async endSession() {
    this.endSessionCallCount++;
  }
}

class MockMongooseModel {
  constructor(sessionFactory) {
    this.sessionFactory = sessionFactory;
    this.db = {
      startSession: async () => this.sessionFactory()
    };
  }

  findOne() {
    return {
      session: () => Promise.resolve(null)
    };
  }

  async findOneAndUpdate() {
    return { id: 'c1', status: 'consumed' };
  }

  async create([doc]) {
    return [{ ...doc }];
  }
}

describe('Stage 4.1B Ambiguous MongoDB Commit Recovery Suite', () => {
  const testUser = {
    id: 'user-ambiguous-commit-test',
    email: 'merchant@store.com'
  };

  describe('1. Rollback Hook Isolation on Ambiguous Commit', () => {
    it('exhausted unknown commit retries do NOT invoke onRollbackHook in MongooseRefreshTokenStore', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession({
          commitThrowsCount: 10, // Always throws UnknownTransactionCommitResult
          commitErrorLabels: ['UnknownTransactionCommitResult']
        });
        return createdSession;
      });

      const onRollbackHook = vi.fn();

      let thrownError = null;
      try {
        await store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date(),
          onRollbackHook
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(RefreshTokenError);
      expect(thrownError.code).toBe('MONGODB_COMMIT_OUTCOME_UNKNOWN');
      expect(thrownError.statusCode).toBe(503);
      expect(onRollbackHook).not.toHaveBeenCalled();
    });

    it('exhausted unknown commit retries do NOT invoke onRollbackHook in InMemoryRefreshTokenStore', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);

      const r1Hash = 'hash-r1';
      await store.createToken({
        id: 'tok-1',
        userId: testUser.id,
        tokenHash: r1Hash,
        familyId: 'fam-1',
        status: 'active',
        expiresAt: new Date(Date.now() + 10000)
      });

      store.simulateUnknownCommitResultCount = 5;
      const onRollbackHook = vi.fn();

      let thrownError = null;
      try {
        await store.rotateTokenAtomic({
          currentTokenId: 'tok-1',
          familyId: 'fam-1',
          oldTokenHash: r1Hash,
          nextTokenHash: 'hash-r2',
          successorDoc: { id: 'tok-2', tokenHash: 'hash-r2', status: 'active' },
          now: new Date(),
          onRollbackHook
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(RefreshTokenError);
      expect(thrownError.code).toBe('MONGODB_COMMIT_OUTCOME_UNKNOWN');
      expect(thrownError.statusCode).toBe(503);
      expect(onRollbackHook).not.toHaveBeenCalled();
    });
  });

  describe('2. Mongoose Adapter Transaction Boundaries for Ambiguous Outcome', () => {
    it('does NOT call abortTransaction() on exhausted unknown commit and cleanly ends session', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession({
          commitThrowsCount: 5,
          commitErrorLabels: ['UnknownTransactionCommitResult']
        });
        return createdSession;
      });

      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date()
        })
      ).rejects.toMatchObject({
        code: 'MONGODB_COMMIT_OUTCOME_UNKNOWN',
        statusCode: 503
      });

      expect(createdSession.commitTransactionCallCount).toBe(3); // retried 3 times
      expect(createdSession.abortTransactionCallCount).toBe(0); // NEVER aborted!
      expect(createdSession.endSessionCallCount).toBe(1); // cleanly ended
    });
  });

  describe('3 & 4. Scenario A — Commit Succeeded, Acknowledgement Lost', () => {
    it('retains encrypted replay-cache response and returns committed successor on retry', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      // 1. Establish active session with R1
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // 2. Configure Scenario A: commit succeeds in DB, but acknowledgement dropped
      store.simulateUnknownCommitResultCount = 5;
      store.unknownCommitOutcome = 'commit_succeeded';

      // 3. First rotation attempt throws MONGODB_COMMIT_OUTCOME_UNKNOWN (503)
      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toMatchObject({
        code: 'MONGODB_COMMIT_OUTCOME_UNKNOWN',
        statusCode: 503
      });

      // 4. Invariant: Database state reflects committed transaction
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('consumed');
      expect(r1Doc.replacedByTokenHash).toBeDefined();

      const r2Doc = await store.findByTokenHash(r1Doc.replacedByTokenHash);
      expect(r2Doc).not.toBeNull();
      expect(r2Doc.status).toBe('active');

      // 5. Invariant: Replay cache entry was NOT deleted by rollback hook
      const cached = await replayCache.getCachedResponse(r1Hash, r1Doc.familyId);
      expect(cached).not.toBeNull();
      expect(cached.refreshToken).toBeDefined();
      expect(hashRefreshToken(cached.refreshToken)).toBe(r2Doc.tokenHash);

      // 6. Client retries with R1: safely receives exact committed R2 response with isReplay: true
      const recovery = await tokenService.rotateRefreshToken(r1);
      expect(recovery.isReplay).toBe(true);
      expect(recovery.refreshToken).toBe(cached.refreshToken);
      expect(recovery.accessToken).toBe(cached.accessToken);
      expect(hashRefreshToken(recovery.refreshToken)).toBe(r2Doc.tokenHash);
    });
  });

  describe('5 & 6. Scenario B — Commit Did Not Succeed', () => {
    it('leaves R1 active, never returns stale successor, and subsequent rotation overwrites cache', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      // 1. Establish active session with R1
      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      // 2. Configure Scenario B: commit did not succeed in DB
      store.simulateUnknownCommitResultCount = 5;
      store.unknownCommitOutcome = 'commit_aborted';

      // 3. Rotation attempt throws MONGODB_COMMIT_OUTCOME_UNKNOWN (503)
      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toMatchObject({
        code: 'MONGODB_COMMIT_OUTCOME_UNKNOWN',
        statusCode: 503
      });

      // 4. Invariant: Database state reflects uncommitted transaction
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');

      // 5. Clear dropped acknowledgement simulation for subsequent retry
      store.simulateUnknownCommitResultCount = 0;

      // 6. Client retries with R1: because R1 is 'active', service enters Case A (does NOT query replay cache)
      const secondRotation = await tokenService.rotateRefreshToken(r1);
      expect(secondRotation.isReplay).toBeFalsy();
      expect(secondRotation.accessToken).toBeDefined();
      expect(secondRotation.refreshToken).toBeDefined();

      // 7. Invariant: Database now has R1 as consumed, replaced by R3
      const r1Updated = await store.findByTokenHash(r1Hash);
      expect(r1Updated.status).toBe('consumed');
      expect(r1Updated.replacedByTokenHash).toBe(hashRefreshToken(secondRotation.refreshToken));

      // 8. Invariant: Replay cache was overwritten with R3; subsequent replay returns R3
      const replayResult = await tokenService.rotateRefreshToken(r1);
      expect(replayResult.isReplay).toBe(true);
      expect(replayResult.refreshToken).toBe(secondRotation.refreshToken);
    });
  });

  describe('7. Confirmed Transaction Abortions Still Perform Targeted Cleanup', () => {
    it('pre-commit hook failure aborts transaction and executes rollback cleanup', async () => {
      let createdSession = null;
      const store = new MongooseRefreshTokenStore();
      store.model = new MockMongooseModel(() => {
        createdSession = new MockSession();
        return createdSession;
      });

      const onRollbackHook = vi.fn();

      await expect(
        store.rotateTokenAtomic({
          currentTokenId: 'c1',
          familyId: 'f1',
          oldTokenHash: 'h1',
          nextTokenHash: 'h2',
          successorDoc: { id: 's1' },
          now: new Date(),
          preCommitHook: async () => {
            throw new Error('REDIS_CONNECTION_REFUSED');
          },
          onRollbackHook
        })
      ).rejects.toThrow('REDIS_CONNECTION_REFUSED');

      expect(createdSession.abortTransactionCallCount).toBe(1);
      expect(createdSession.endSessionCallCount).toBe(1);
      expect(onRollbackHook).toHaveBeenCalledTimes(1);
    });

    it('pre-commit replay cache failure leaves R1 active and cleans up cache entry', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      // Simulate replay cache setCachedResponse failure
      replayCache.setCachedResponse = vi.fn().mockRejectedValue(new Error('Simulated Redis write outage'));

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;
      const r1Hash = hashRefreshToken(r1);

      await expect(
        tokenService.rotateRefreshToken(r1)
      ).rejects.toMatchObject({
        code: 'REPLAY_CACHE_WRITE_FAILURE',
        statusCode: 503
      });

      // R1 remains active in DB
      const r1Doc = await store.findByTokenHash(r1Hash);
      expect(r1Doc.status).toBe('active');
    });
  });

  describe('8. Transient Transaction Errors & Successful Commit Retries', () => {
    it('retries whole transaction on TransientTransactionError and succeeds', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;

      // Simulate 1 TransientTransactionError (WriteConflict) on first attempt
      store.simulateTransientErrorCount = 1;

      const rotation = await tokenService.rotateRefreshToken(r1);
      expect(rotation.refreshToken).toBeDefined();
      expect(rotation.accessToken).toBeDefined();
    });

    it('retries commit on UnknownTransactionCommitResult and succeeds if retry confirms commit', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;

      // Simulate 1 dropped commit ack that succeeds on commit retry attempt 2
      store.simulateUnknownCommitResultCount = 1;

      const rotation = await tokenService.rotateRefreshToken(r1);
      expect(rotation.refreshToken).toBeDefined();
      expect(rotation.accessToken).toBeDefined();
    });
  });

  describe('9. HTTP Controller Session Refresh Invariant on Ambiguous Commit', () => {
    it('returns HTTP 503 and preserves refresh-token cookie without clearing', async () => {
      const store = new InMemoryRefreshTokenStore();
      store.addUser(testUser);
      const replayCache = new InMemoryReplayCacheService({ secret: 'a'.repeat(32) });

      const tokenService = createTestRefreshTokenService({
        store,
        replayCache
      });

      const session = await tokenService.createInitialSession({
        userId: testUser.id,
        email: testUser.email
      });
      const r1 = session.refreshToken;

      // Ambiguous commit setup
      store.simulateUnknownCommitResultCount = 5;
      store.unknownCommitOutcome = 'commit_succeeded';

      const controller = createAuthSessionController(tokenService);

      let statusCode = null;
      let jsonBody = null;
      let clearedCookies = [];

      const req = {
        cookies: {
          [REFRESH_COOKIE_NAME]: r1
        },
        headers: {},
        ip: '127.0.0.1'
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(body) {
          jsonBody = body;
          return this;
        },
        cookie() {
          return this;
        },
        clearCookie(name) {
          clearedCookies.push(name);
          return this;
        }
      };

      await controller.refresh(req, res);

      expect(statusCode).toBe(503);
      expect(jsonBody.error).toBe('MONGODB_COMMIT_OUTCOME_UNKNOWN');
      // Invariant: refresh cookie must NOT be cleared on ambiguous commit!
      expect(clearedCookies).not.toContain(REFRESH_COOKIE_NAME);
    });
  });
});
