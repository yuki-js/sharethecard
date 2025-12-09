/**
 * Session Repository
 * Manages session storage and retrieval
 */

export interface SessionData {
  sessionToken: string;
  controllerId: string; // Controller who owns this session
  cardhostUuid?: string; // Set when relay session is created
  expiresAt: Date;
  createdAt: Date;
  lastActivityAt: Date;
}

export class SessionRepository {
  private sessions = new Map<string, SessionData>();

  /**
   * Create new session
   */
  create(data: Omit<SessionData, 'lastActivityAt'>): void {
    this.sessions.set(data.sessionToken, {
      ...data,
      lastActivityAt: data.createdAt,
    });
  }

  /**
   * Get session by token
   */
  get(sessionToken: string): SessionData | undefined {
    return this.sessions.get(sessionToken);
  }

  /**
   * Update session
   */
  update(sessionToken: string, partial: Partial<SessionData>): boolean {
    const session = this.sessions.get(sessionToken);
    if (!session) {
      return false;
    }
    Object.assign(session, partial);
    return true;
  }

  /**
   * Delete session
   */
  delete(sessionToken: string): boolean {
    return this.sessions.delete(sessionToken);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(sessionToken: string): void {
    const session = this.sessions.get(sessionToken);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  /**
   * Find session by cardhost UUID
   */
  findByCardhostUuid(cardhostUuid: string): SessionData | undefined {
    for (const session of this.sessions.values()) {
      if (session.cardhostUuid === cardhostUuid) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Get all sessions
   */
  getAll(): SessionData[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpired(): number {
    const now = new Date();
    let count = 0;
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Cleanup inactive sessions
   */
  cleanupInactive(maxIdleMs: number): number {
    const now = new Date();
    let count = 0;
    for (const [token, session] of this.sessions.entries()) {
      const idleMs = now.getTime() - session.lastActivityAt.getTime();
      if (idleMs > maxIdleMs) {
        this.sessions.delete(token);
        count++;
      }
    }
    return count;
  }

  /**
   * Get count
   */
  count(): number {
    return this.sessions.size;
  }

  /**
   * Clear all
   */
  clear(): void {
    this.sessions.clear();
  }
}