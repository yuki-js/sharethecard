/**
 * Cardhost Authentication Manager for Router
 * Handles public key challenge-response authentication
 *
 * Spec: docs/what-to-make.md Section 4.1.1 - Cardhost認証フロー
 */

import { webcrypto } from "node:crypto";
import { generateRandomBase64, canonicalizeJson } from "@remote-apdu/shared";
import type { CardhostInfo } from "@remote-apdu/shared";

export interface CardhostRegistry {
  uuid: string;
  publicKey: string;
  connected: boolean;
  connectedAt?: Date;
}

interface Challenge {
  challenge: string;
  timestamp: number;
}

/**
 * Manages Cardhost authentication via Ed25519 public key
 */
export class CardhostAuth {
  private registry: Map<string, CardhostRegistry> = new Map();
  private challenges: Map<string, Challenge> = new Map();
  private readonly CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Initiate authentication - register UUID and public key, issue challenge
   *
   * Step 1 of challenge-response auth
   */
  async initiateAuth(uuid: string, publicKey: string): Promise<string> {
    // Register or update Cardhost
    const existing = this.registry.get(uuid);

    this.registry.set(uuid, {
      uuid,
      publicKey,
      connected: existing?.connected ?? false,
      connectedAt: existing?.connectedAt,
    });

    // Generate cryptographic challenge
    const challenge = generateRandomBase64(32);

    this.challenges.set(uuid, {
      challenge,
      timestamp: Date.now(),
    });

    return challenge;
  }

  /**
   * Verify authentication - validate Ed25519 signature over challenge
   *
   * Step 2 of challenge-response auth
   */
  async verifyAuth(
    uuid: string,
    challenge: string,
    signatureBase64: string,
  ): Promise<boolean> {
    // Get registered Cardhost
    const cardhost = this.registry.get(uuid);
    if (!cardhost) {
      throw new Error("Cardhost not registered");
    }

    // Get stored challenge
    const stored = this.challenges.get(uuid);
    if (!stored) {
      throw new Error("No challenge found for this Cardhost");
    }

    // Check challenge timeout
    if (Date.now() - stored.timestamp > this.CHALLENGE_TIMEOUT_MS) {
      this.challenges.delete(uuid);
      throw new Error("Challenge expired");
    }

    // Verify challenge matches
    if (stored.challenge !== challenge) {
      throw new Error("Challenge mismatch");
    }

    // Verify Ed25519 signature
    const isValid = await this.verifySignature(
      challenge,
      cardhost.publicKey,
      signatureBase64,
    );

    if (!isValid) {
      return false;
    }

    // Mark as connected
    cardhost.connected = true;
    cardhost.connectedAt = new Date();

    // Remove used challenge
    this.challenges.delete(uuid);

    return true;
  }

  /**
   * Verify Ed25519 signature using webcrypto
   */
  private async verifySignature(
    challenge: string,
    publicKeyBase64: string,
    signatureBase64: string,
  ): Promise<boolean> {
    try {
      // Import Ed25519 public key
      const publicKeyDer = Buffer.from(publicKeyBase64, "base64");
      const publicKey = await webcrypto.subtle.importKey(
        "spki",
        publicKeyDer,
        { name: "Ed25519" },
        false,
        ["verify"],
      );

      // Canonical payload (same as Cardhost's signing)
      const payload = canonicalizeJson(challenge);

      // Verify signature
      const signature = Buffer.from(signatureBase64, "base64");
      return await webcrypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        signature,
        payload,
      );
    } catch (error) {
      // Signature verification failed; suppress logging in library code
      return false;
    }
  }

  /**
   * Check if Cardhost is connected
   */
  isConnected(uuid: string): boolean {
    const cardhost = this.registry.get(uuid);
    return cardhost?.connected ?? false;
  }

  /**
   * Get Cardhost info
   */
  getCardhost(uuid: string): CardhostRegistry | undefined {
    return this.registry.get(uuid);
  }

  /**
   * List all registered Cardhosts
   */
  listCardhosts(): CardhostInfo[] {
    return Array.from(this.registry.values()).map((ch) => ({
      uuid: ch.uuid,
      connected: ch.connected,
    }));
  }

  /**
   * Mark Cardhost as disconnected
   */
  disconnect(uuid: string): void {
    const cardhost = this.registry.get(uuid);
    if (cardhost) {
      cardhost.connected = false;
    }
  }

  /**
   * Cleanup expired challenges
   */
  cleanupExpiredChallenges(): void {
    const now = Date.now();
    for (const [uuid, challenge] of this.challenges.entries()) {
      if (now - challenge.timestamp > this.CHALLENGE_TIMEOUT_MS) {
        this.challenges.delete(uuid);
      }
    }
  }
}
