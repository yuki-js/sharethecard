/**
 * Cardhost Repository
 * Manages cardhost registration and authentication state
 */

export interface CardhostData {
  uuid: string;
  publicKey: string;
  connected: boolean;
  connectedAt?: Date;
  registeredAt: Date;
}

export interface ChallengeData {
  challenge: string;
  timestamp: number;
}

export class CardhostRepository {
  private cardhosts = new Map<string, CardhostData>();
  private challenges = new Map<string, ChallengeData>();

  /**
   * Register cardhost
   */
  register(uuid: string, publicKey: string): void {
    const existing = this.cardhosts.get(uuid);
    this.cardhosts.set(uuid, {
      uuid,
      publicKey,
      connected: existing?.connected ?? false,
      connectedAt: existing?.connectedAt,
      registeredAt: existing?.registeredAt ?? new Date(),
    });
  }

  /**
   * Get cardhost by UUID
   */
  get(uuid: string): CardhostData | undefined {
    return this.cardhosts.get(uuid);
  }

  /**
   * Mark cardhost as connected
   */
  setConnected(uuid: string, connected: boolean): boolean {
    const cardhost = this.cardhosts.get(uuid);
    if (!cardhost) {
      return false;
    }
    cardhost.connected = connected;
    cardhost.connectedAt = connected ? new Date() : undefined;
    return true;
  }

  /**
   * Check if cardhost is connected
   */
  isConnected(uuid: string): boolean {
    return this.cardhosts.get(uuid)?.connected ?? false;
  }

  /**
   * List all cardhosts
   */
  listAll(): CardhostData[] {
    return Array.from(this.cardhosts.values());
  }

  /**
   * Store challenge for authentication
   */
  storeChallenge(uuid: string, challenge: string): void {
    this.challenges.set(uuid, {
      challenge,
      timestamp: Date.now(),
    });
  }

  /**
   * Get challenge
   */
  getChallenge(uuid: string): ChallengeData | undefined {
    return this.challenges.get(uuid);
  }

  /**
   * Remove challenge
   */
  removeChallenge(uuid: string): boolean {
    return this.challenges.delete(uuid);
  }

  /**
   * Cleanup expired challenges
   */
  cleanupExpiredChallenges(timeoutMs: number): number {
    const now = Date.now();
    let count = 0;
    for (const [uuid, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > timeoutMs) {
        this.challenges.delete(uuid);
        count++;
      }
    }
    return count;
  }

  /**
   * Get count
   */
  count(): number {
    return this.cardhosts.size;
  }

  /**
   * Count connected cardhosts
   */
  countConnected(): number {
    return Array.from(this.cardhosts.values()).filter((c) => c.connected)
      .length;
  }

  /**
   * Clear all
   */
  clear(): void {
    this.cardhosts.clear();
    this.challenges.clear();
  }
}