/**
 * Controller Repository
 * Manages controller registration and authentication state
 */

export interface ControllerData {
  controllerId: string; // Unique identifier (can be derived from public key)
  publicKey: string;
  authenticated: boolean;
  authenticatedAt?: Date;
  registeredAt: Date;
}

export interface ControllerChallengeData {
  challenge: string;
  timestamp: number;
}

export class ControllerRepository {
  private controllers = new Map<string, ControllerData>();
  private challenges = new Map<string, ControllerChallengeData>();

  /**
   * Register controller
   */
  register(controllerId: string, publicKey: string): void {
    const existing = this.controllers.get(controllerId);
    this.controllers.set(controllerId, {
      controllerId,
      publicKey,
      authenticated: existing?.authenticated ?? false,
      authenticatedAt: existing?.authenticatedAt,
      registeredAt: existing?.registeredAt ?? new Date(),
    });
  }

  /**
   * Get controller by ID
   */
  get(controllerId: string): ControllerData | undefined {
    return this.controllers.get(controllerId);
  }

  /**
   * Mark controller as authenticated
   */
  setAuthenticated(controllerId: string, authenticated: boolean): boolean {
    const controller = this.controllers.get(controllerId);
    if (!controller) {
      return false;
    }
    controller.authenticated = authenticated;
    controller.authenticatedAt = authenticated ? new Date() : undefined;
    return true;
  }

  /**
   * Check if controller is authenticated
   */
  isAuthenticated(controllerId: string): boolean {
    return this.controllers.get(controllerId)?.authenticated ?? false;
  }

  /**
   * List all controllers
   */
  listAll(): ControllerData[] {
    return Array.from(this.controllers.values());
  }

  /**
   * Store challenge for authentication
   */
  storeChallenge(controllerId: string, challenge: string): void {
    this.challenges.set(controllerId, {
      challenge,
      timestamp: Date.now(),
    });
  }

  /**
   * Get challenge
   */
  getChallenge(controllerId: string): ControllerChallengeData | undefined {
    return this.challenges.get(controllerId);
  }

  /**
   * Remove challenge
   */
  removeChallenge(controllerId: string): boolean {
    return this.challenges.delete(controllerId);
  }

  /**
   * Cleanup expired challenges
   */
  cleanupExpiredChallenges(timeoutMs: number): number {
    const now = Date.now();
    let count = 0;
    for (const [id, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > timeoutMs) {
        this.challenges.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get count
   */
  count(): number {
    return this.controllers.size;
  }

  /**
   * Count authenticated controllers
   */
  countAuthenticated(): number {
    return Array.from(this.controllers.values()).filter((c) => c.authenticated)
      .length;
  }

  /**
   * Clear all
   */
  clear(): void {
    this.controllers.clear();
    this.challenges.clear();
  }
}