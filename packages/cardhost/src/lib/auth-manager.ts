/**
 * Authentication Manager for Cardhost
 * Handles challenge-response authentication with Router
 *
 * Spec: docs/what-to-make.md Section 4.1.1 - 認証フロー
 */

import { fetch } from "undici";
import { webcrypto } from "node:crypto";
import { canonicalizeJson, createLogger } from "@remote-apdu/shared";
import type { CardHostPersistedConfig } from "./config-manager.js";

const logger = createLogger("cardhost:auth");

export interface AuthenticationResult {
  authenticated: boolean;
  challenge?: string;
}

/**
 * Manages Cardhost authentication with Router
 * Implements public key challenge-response authentication
 */
export class AuthManager {
  constructor(private routerUrl: string) {}

  /**
   * Authenticate with Router using Ed25519 keypair
   *
   * NEW FLOW (API 2025-12-09):
   * 1. Send ONLY public key to Router (no UUID)
   * 2. Receive Router-derived UUID + challenge
   * 3. Sign challenge with private key
   * 4. Send signature for verification
   *
   * Router derives UUID from public key hash to prevent:
   * - Collision attacks
   * - Impersonation attacks
   * - Namespace pollution
   */
  async authenticate(
    config: CardHostPersistedConfig,
  ): Promise<AuthenticationResult & { derivedUuid?: string }> {
    logger.info("Starting authentication", { routerUrl: this.routerUrl });
    
    // Step 1: Connect with public key ONLY (Router will derive UUID)
    const connectPayload = {
      publicKey: config.signingPublicKey,
    };

    logger.debug("Sending connect request", { operation: "connect" });
    const connectResponse = await fetch(`${this.routerUrl}/cardhost/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connectPayload),
    });

    if (!connectResponse.ok) {
      const error = await connectResponse.text();
      logger.error("Connect request failed", new Error(error), {
        status: connectResponse.status,
      });
      throw new Error(`Connect failed: ${connectResponse.status} - ${error}`);
    }

    const { uuid: derivedUuid, challenge } = (await connectResponse.json()) as {
      uuid: string;
      challenge: string;
    };
    
    logger.debug("Received Router-derived UUID", { uuid: derivedUuid });

    // Step 2: Verify Router-derived UUID matches public key (security check)
    logger.debug("Verifying UUID derivation", { operation: "verify-uuid" });
    await this.verifyDerivedUuid(derivedUuid, config.signingPublicKey);
    logger.info("UUID verification successful", { uuid: derivedUuid });

    // Step 3: Sign challenge with Ed25519 private key
    logger.debug("Signing challenge", { operation: "sign-challenge" });
    const signature = await this.signChallenge(
      challenge,
      config.signingPrivateKey,
    );

    // Step 4: Verify signature with Router (use Router-derived UUID)
    const verifyPayload = {
      uuid: derivedUuid,
      challenge,
      signature,
    };

    logger.debug("Sending verify request", { operation: "verify" });
    const verifyResponse = await fetch(`${this.routerUrl}/cardhost/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyResponse.ok) {
      const error = await verifyResponse.text();
      logger.error("Verification failed", new Error(error), {
        status: verifyResponse.status,
      });
      throw new Error(
        `Verification failed: ${verifyResponse.status} - ${error}`,
      );
    }

    logger.info("Authentication successful", { uuid: derivedUuid });
    return {
      authenticated: true,
      challenge,
      derivedUuid, // Return Router-derived UUID for persistence
    };
  }

  /**
   * Verify that Router-derived UUID matches public key hash
   * This prevents man-in-the-middle attacks where Router might return wrong UUID
   */
  private async verifyDerivedUuid(
    derivedUuid: string,
    publicKeyBase64: string,
  ): Promise<void> {
    try {
      const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
      const hashBuffer = await webcrypto.subtle.digest("SHA-256", publicKeyBytes);
      
      const base64 = Buffer.from(hashBuffer).toString("base64");
      const base64url = base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
      
      const expectedUuid = `peer_${base64url}`;
      
      if (derivedUuid !== expectedUuid) {
        logger.error("UUID verification failed", undefined, {
          received: derivedUuid,
          expected: expectedUuid,
        });
        throw new Error(
          `UUID verification failed: Router returned ${derivedUuid} but expected ${expectedUuid}. ` +
          `Possible man-in-the-middle attack or Router implementation error.`
        );
      }
    } catch (error) {
      logger.error("UUID derivation error", error as Error);
      throw error;
    }
  }

  /**
   * Sign challenge using Ed25519 private key
   * Uses canonical JSON format for consistent signing
   */
  private async signChallenge(
    challenge: string,
    privateKeyBase64: string,
  ): Promise<string> {
    // Import private key
    const privateKeyDer = Buffer.from(privateKeyBase64, "base64");
    const privateKey = await webcrypto.subtle.importKey(
      "pkcs8",
      privateKeyDer,
      { name: "Ed25519" },
      false,
      ["sign"],
    );

    // Create canonical payload
    const payload = canonicalizeJson(challenge);

    // Sign
    const signature = await webcrypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      payload,
    );

    return Buffer.from(signature).toString("base64");
  }

  /**
   * Update router URL for authentication
   */
  setRouterUrl(url: string): void {
    this.routerUrl = url;
  }

  /**
   * Get router URL (avoid private property access)
   */
  getRouterUrl(): string {
    return this.routerUrl;
  }
}
