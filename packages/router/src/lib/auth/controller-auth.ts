/**
 * Controller Authentication Manager for Router
 * Handles bearer token validation and session token issuance
 * 
 * Spec: docs/what-to-make.md Section 4.2.1 - Controller認証フロー
 */

import { generateRandomBase64 } from '@remote-apdu/shared';
import type { SessionToken } from '@remote-apdu/shared';

export interface ControllerSession {
  sessionId: string;
  bearerToken: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Manages Controller authentication via bearer tokens
 */
export class ControllerAuth {
  private sessions: Map<string, ControllerSession> = new Map();
  private readonly SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Authenticate Controller with bearer token
   * Issues session token for subsequent requests
   */
  async authenticate(bearerToken: string): Promise<SessionToken> {
    // Validate bearer token
    if (!this.validateBearerToken(bearerToken)) {
      throw new Error('Invalid bearer token');
    }

    // Generate session token
    const sessionId = `sess_${generateRandomBase64(32)}`;
    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MS);

    const session: ControllerSession = {
      sessionId,
      bearerToken,
      expiresAt,
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    return {
      token: sessionId,
      expiresAt: expiresAt.toISOString()
    };
  }

  /**
   * Validate bearer token format and content
   * 
   * Current implementation: basic length check
   * Production: JWT verification, database lookup, etc.
   */
  private validateBearerToken(token: string): boolean {
    // Minimum security: require sufficient length
    return token.length >= 10;
  }

  /**
   * Validate session token
   */
  validateSession(sessionToken: string): ControllerSession | null {
    const session = this.sessions.get(sessionToken);
    
    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      this.sessions.delete(sessionToken);
      return null;
    }

    return session;
  }

  /**
   * Revoke session
   */
  revokeSession(sessionToken: string): void {
    this.sessions.delete(sessionToken);
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    this.cleanupExpiredSessions();
    return this.sessions.size;
  }
}