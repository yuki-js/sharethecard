/**
 * Session Service
 * Manages controller sessions for cardhost connection identification
 *
 * IMPORTANT: This service handles IDENTIFICATION only, not authentication.
 * Authentication is handled separately via public key cryptography.
 */

import type { SessionRepository, SessionData } from "../repository/session-repository.js";
import { generateRandomBase64 } from "../shared/random.js";
import type { SessionToken } from "../shared/types.js";

export class SessionService {
  private readonly SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

  constructor(private sessionRepo: SessionRepository) {}

  /**
   * Create new controller session for cardhost identification
   *
   * This creates a session token that identifies which cardhost
   * an authenticated controller wants to connect to.
   */
  createSession(controllerId: string): SessionToken {
    const sessionToken = `sess_${generateRandomBase64(32)}`;
    const expiresAt = new Date(Date.now() + this.SESSION_DURATION_MS);

    this.sessionRepo.create({
      sessionToken,
      controllerId,
      expiresAt,
      createdAt: new Date(),
    });

    return {
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Validate session token
   * Returns session data if valid, null if invalid or expired
   */
  validateSession(sessionToken: string): SessionData | null {
    const session = this.sessionRepo.get(sessionToken);
    if (!session) {
      return null;
    }

    // Check expiration
    if (session.expiresAt < new Date()) {
      this.sessionRepo.delete(sessionToken);
      return null;
    }

    return session;
  }

  /**
   * Associate cardhost with session (creates relay session)
   */
  associateCardhost(sessionToken: string, cardhostUuid: string): boolean {
    return this.sessionRepo.update(sessionToken, { cardhostUuid });
  }

  /**
   * Update session activity timestamp
   */
  updateActivity(sessionToken: string): void {
    this.sessionRepo.updateActivity(sessionToken);
  }

  /**
   * Find session by cardhost UUID
   */
  findByCardhostUuid(cardhostUuid: string): SessionData | undefined {
    return this.sessionRepo.findByCardhostUuid(cardhostUuid);
  }

  /**
   * Revoke session
   */
  revokeSession(sessionToken: string): void {
    this.sessionRepo.delete(sessionToken);
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpired(): void {
    this.sessionRepo.cleanupExpired();
  }

  /**
   * Cleanup inactive sessions
   */
  cleanupInactive(maxIdleMs: number): void {
    this.sessionRepo.cleanupInactive(maxIdleMs);
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    this.cleanupExpired();
    return this.sessionRepo.count();
  }
}