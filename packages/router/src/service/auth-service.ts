/**
 * Auth Service
 * Handles bearer token validation and cardhost public key authentication
 */

import { generateRandomBase64 } from "../shared/random.js";
import { CardhostRepository } from "../repository/cardhost-repository.js";
import { verifyEd25519Signature } from "../shared/signature-verification.js";
import { randomUUID } from "node:crypto";

export class AuthService {
  private readonly CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private cardhostRepo: CardhostRepository) {}

  /**
   * Initiate cardhost authentication
   * Step 1: Assign RFC 4122 UUID v4 for the cardhost public key, register, and issue challenge
   *
   * IMPORTANT: Cardhost UUID is assigned by the Router (RFC 4122 v4) and is not chosen or derived by the peer.
   */
  async initiateCardhostAuth(publicKey: string): Promise<{ uuid: string; challenge: string }> {
    // Reuse existing UUID if this public key already registered in this runtime
    let uuid = this.cardhostRepo.findUuidByPublicKey(publicKey);
    if (!uuid) {
      uuid = randomUUID(); // RFC 4122 UUID v4
    }

    // Register/update cardhost mapping
    this.cardhostRepo.register(uuid, publicKey);

    // Generate cryptographic challenge
    const challenge = generateRandomBase64(32);
    this.cardhostRepo.storeChallenge(uuid, challenge);

    return { uuid, challenge };
  }

  /**
   * Verify cardhost authentication
   * Step 2: Verify Ed25519 signature over challenge
   */
  async verifyCardhostAuth(
    uuid: string,
    challenge: string,
    signatureBase64: string,
  ): Promise<boolean> {
    // Get registered cardhost
    const cardhost = this.cardhostRepo.get(uuid);
    if (!cardhost) {
      throw new Error("Cardhost not registered");
    }

    // Get stored challenge
    const stored = this.cardhostRepo.getChallenge(uuid);
    if (!stored) {
      throw new Error("No challenge found for this Cardhost");
    }

    // Check challenge timeout
    if (Date.now() - stored.timestamp > this.CHALLENGE_TIMEOUT_MS) {
      this.cardhostRepo.removeChallenge(uuid);
      throw new Error("Challenge expired");
    }

    // Verify challenge matches
    if (stored.challenge !== challenge) {
      throw new Error("Challenge mismatch");
    }

    // Verify Ed25519 signature
    const isValid = await verifyEd25519Signature(
      challenge,
      cardhost.publicKey,
      signatureBase64,
    );

    if (!isValid) {
      return false;
    }

    // Mark as connected
    this.cardhostRepo.setConnected(uuid, true);

    // Remove used challenge
    this.cardhostRepo.removeChallenge(uuid);

    return true;
  }

  /**
   * Mark cardhost as disconnected
   */
  disconnectCardhost(uuid: string): void {
    this.cardhostRepo.setConnected(uuid, false);
  }

  /**
   * Check if cardhost is connected
   */
  isCardhostConnected(uuid: string): boolean {
    return this.cardhostRepo.isConnected(uuid);
  }

  /**
   * Cleanup expired challenges
   */
  cleanupExpiredChallenges(): void {
    this.cardhostRepo.cleanupExpiredChallenges(this.CHALLENGE_TIMEOUT_MS);
  }
}