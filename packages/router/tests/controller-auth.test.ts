/**
 * Unit tests for ControllerAuth
 * 
 * Tests bearer token authentication and session token management
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ControllerAuth } from '../src/lib/auth/controller-auth.js';

describe('ControllerAuth', () => {
  let auth: ControllerAuth;

  beforeEach(() => {
    auth = new ControllerAuth();
  });

  describe('Bearer Token Authentication', () => {
    it('should authenticate valid bearer token', async () => {
      const token = 'valid-bearer-token-123';
      
      const sessionToken = await auth.authenticate(token);

      expect(sessionToken).toHaveProperty('token');
      expect(sessionToken).toHaveProperty('expiresAt');
      expect(sessionToken.token).toMatch(/^sess_/);
    });

    it('should reject bearer token shorter than 10 characters', async () => {
      const shortToken = 'short';

      await expect(
        auth.authenticate(shortToken)
      ).rejects.toThrow('Invalid bearer token');
    });

    it('should accept bearer token with exactly 10 characters', async () => {
      const token = '1234567890';

      const sessionToken = await auth.authenticate(token);

      expect(sessionToken.token).toMatch(/^sess_/);
    });

    it('should generate unique session tokens', async () => {
      const token1 = await auth.authenticate('valid-token-1');
      const token2 = await auth.authenticate('valid-token-2');

      expect(token1.token).not.toBe(token2.token);
    });

    it('should set expiration to 1 hour in future', async () => {
      const beforeAuth = Date.now();
      const sessionToken = await auth.authenticate('valid-token-123');
      const afterAuth = Date.now();

      const expiresAt = new Date(sessionToken.expiresAt).getTime();
      const expectedMin = beforeAuth + 59 * 60 * 1000; // 59 minutes
      const expectedMax = afterAuth + 61 * 60 * 1000; // 61 minutes

      expect(expiresAt).toBeGreaterThan(expectedMin);
      expect(expiresAt).toBeLessThan(expectedMax);
    });
  });

  describe('Session Validation', () => {
    it('should validate valid session token', async () => {
      const sessionToken = await auth.authenticate('valid-bearer');
      
      const session = auth.validateSession(sessionToken.token);

      expect(session).not.toBeNull();
      expect(session?.sessionId).toBe(sessionToken.token);
    });

    it('should return null for non-existent session', () => {
      const session = auth.validateSession('non-existent-session');

      expect(session).toBeNull();
    });

    it('should return null for expired session', async () => {
      const sessionToken = await auth.authenticate('valid-bearer');

      // Manually expire session
      const session = auth.validateSession(sessionToken.token);
      if (session) {
        session.expiresAt = new Date(Date.now() - 1000); // 1 second ago
      }

      const result = auth.validateSession(sessionToken.token);

      expect(result).toBeNull();
    });

    it('should remove expired session from storage', async () => {
      const sessionToken = await auth.authenticate('valid-bearer');

      // Manually expire
      const session = auth.validateSession(sessionToken.token);
      if (session) {
        session.expiresAt = new Date(Date.now() - 1000);
      }

      // First validation removes it
      auth.validateSession(sessionToken.token);

      // Second validation should also return null
      const result = auth.validateSession(sessionToken.token);
      expect(result).toBeNull();
    });
  });

  describe('Session Revocation', () => {
    it('should revoke session', async () => {
      const sessionToken = await auth.authenticate('valid-bearer');

      auth.revokeSession(sessionToken.token);

      const session = auth.validateSession(sessionToken.token);
      expect(session).toBeNull();
    });

    it('should not throw error when revoking non-existent session', () => {
      expect(() => {
        auth.revokeSession('non-existent');
      }).not.toThrow();
    });
  });

  describe('Session Cleanup', () => {
    it('should cleanup expired sessions', async () => {
      const token1 = await auth.authenticate('bearer-1');
      const token2 = await auth.authenticate('bearer-2');

      // Expire first session
      const session1 = auth.validateSession(token1.token);
      if (session1) {
        session1.expiresAt = new Date(Date.now() - 1000);
      }

      // Cleanup
      auth.cleanupExpiredSessions();

      // First should be removed, second should remain
      expect(auth.validateSession(token1.token)).toBeNull();
      expect(auth.validateSession(token2.token)).not.toBeNull();
    });

    it('should not affect valid sessions during cleanup', async () => {
      const tokens = await Promise.all([
        auth.authenticate('bearer-1'),
        auth.authenticate('bearer-2'),
        auth.authenticate('bearer-3')
      ]);

      auth.cleanupExpiredSessions();

      // All should still be valid
      for (const token of tokens) {
        expect(auth.validateSession(token.token)).not.toBeNull();
      }
    });
  });

  describe('Active Session Count', () => {
    it('should return 0 for no sessions', () => {
      const count = auth.getActiveSessionCount();

      expect(count).toBe(0);
    });

    it('should count active sessions', async () => {
      await auth.authenticate('bearer-1');
      await auth.authenticate('bearer-2');

      const count = auth.getActiveSessionCount();

      expect(count).toBe(2);
    });

    it('should not count expired sessions', async () => {
      const token1 = await auth.authenticate('bearer-1');
      await auth.authenticate('bearer-2');

      // Expire first
      const session1 = auth.validateSession(token1.token);
      if (session1) {
        session1.expiresAt = new Date(Date.now() - 1000);
      }

      const count = auth.getActiveSessionCount();

      expect(count).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty bearer token', async () => {
      await expect(
        auth.authenticate('')
      ).rejects.toThrow('Invalid bearer token');
    });

    it('should handle very long bearer token', async () => {
      const longToken = 'a'.repeat(1000);

      const sessionToken = await auth.authenticate(longToken);

      expect(sessionToken.token).toMatch(/^sess_/);
    });

    it('should handle special characters in bearer token', async () => {
      const token = 'bearer-with-special-chars-!@#$%^&*()';

      const sessionToken = await auth.authenticate(token);

      expect(sessionToken.token).toBeDefined();
    });
  });
});