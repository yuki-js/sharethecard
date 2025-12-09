/**
 * Auth Service
 * Handles bearer token validation and cardhost public key authentication
 */

import { generateRandomBase64 } from "@remote-apdu/shared";
import { CardhostRepository } from "../repository/cardhost-repository.js";
import { generatePeerId, verifyPeerId } from "../shared/peer-id.js";
import { verifyEd25519Signature } from "../shared/signature-verification.js";

export class AuthService {
  private readonly CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private cardhostRepo: CardhostRepository) {}

  /**
   * Initiate cardhost authentication
   * Step 1: Derive cardhost UUID from public key, register, and issue challenge
   *
   * IMPORTANT: Cardhost UUID is derived from public key, not chosen by peer.
   * This prevents impersonation and collision attacks.
   */
  async initiateCardhostAuth(publicKey: string): Promise<{ uuid: string; challenge: string }> {
    // Derive UUID from public key (cannot be chosen by peer)
    const uuid = await generatePeerId(publicKey);
    
    // Register cardhost
    this.cardhostRepo.register(uuid, publicKey);

    // Generate cryptographic challenge
    const challenge = generateRandomBase64(32);
    this.cardhostRepo.storeChallenge(uuid, challenge);

    return { uuid, challenge };
  }

  /**
   * Verify cardhost authentication
   * Step 2: Verify Ed25519 signature over challenge and UUID binding
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

    // Verify UUID is correctly derived from public key
    if (!(await verifyPeerId(uuid, cardhost.publicKey))) {
      throw new Error("Cardhost UUID does not match public key");
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