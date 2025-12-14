/**
 * Controller Authentication Service
 * Handles controller public key challenge-response authentication
 * 
 * Controllers authenticate using Ed25519 public key cryptography,
 * similar to cardhosts.
 */

import { generateRandomBase64 } from "../shared/random.js";
import { ControllerRepository } from "../repository/controller-repository.js";
import { generatePeerId, verifyPeerId } from "../shared/peer-id.js";
import { verifyEd25519Signature } from "../shared/signature-verification.js";

export class ControllerAuthService {
  private readonly CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private controllerRepo: ControllerRepository) {}

  /**
   * Initiate controller authentication
   * Step 1: Derive controller ID from public key, register, and issue challenge
   *
   * IMPORTANT: Controller ID is derived from public key, not chosen by peer.
   * This prevents impersonation and collision attacks.
   */
  async initiateAuth(publicKey: string): Promise<{ controllerId: string; challenge: string }> {
    // Derive controller ID from public key (cannot be chosen by peer)
    const controllerId = await generatePeerId(publicKey);
    
    // Register controller
    this.controllerRepo.register(controllerId, publicKey);

    // Generate cryptographic challenge
    const challenge = generateRandomBase64(32);
    this.controllerRepo.storeChallenge(controllerId, challenge);

    return { controllerId, challenge };
  }

  /**
   * Verify controller authentication
   * Step 2: Verify Ed25519 signature over challenge and peer ID binding
   */
  async verifyAuth(
    controllerId: string,
    challenge: string,
    signatureBase64: string,
  ): Promise<boolean> {
    // Get registered controller
    const controller = this.controllerRepo.get(controllerId);
    if (!controller) {
      throw new Error("Controller not registered");
    }

    // Verify controller ID is correctly derived from public key
    if (!(await verifyPeerId(controllerId, controller.publicKey))) {
      throw new Error("Controller ID does not match public key");
    }

    // Get stored challenge
    const stored = this.controllerRepo.getChallenge(controllerId);
    if (!stored) {
      throw new Error("No challenge found for this Controller");
    }

    // Check challenge timeout
    if (Date.now() - stored.timestamp > this.CHALLENGE_TIMEOUT_MS) {
      this.controllerRepo.removeChallenge(controllerId);
      throw new Error("Challenge expired");
    }

    // Verify challenge matches
    if (stored.challenge !== challenge) {
      throw new Error("Challenge mismatch");
    }

    // Verify Ed25519 signature
    const isValid = await verifyEd25519Signature(
      challenge,
      controller.publicKey,
      signatureBase64,
    );

    if (!isValid) {
      return false;
    }

    // Mark as authenticated
    this.controllerRepo.setAuthenticated(controllerId, true);

    // Remove used challenge
    this.controllerRepo.removeChallenge(controllerId);

    return true;
  }

  /**
   * Mark controller as disconnected
   */
  disconnectController(controllerId: string): void {
    this.controllerRepo.setAuthenticated(controllerId, false);
  }

  /**
   * Check if controller is authenticated
   */
  isAuthenticated(controllerId: string): boolean {
    return this.controllerRepo.isAuthenticated(controllerId);
  }

  /**
   * Cleanup expired challenges
   */
  cleanupExpiredChallenges(): void {
    this.controllerRepo.cleanupExpiredChallenges(this.CHALLENGE_TIMEOUT_MS);
  }
}