/**
 * Authentication Manager for Cardhost
 * Handles challenge-response authentication with Router
 * 
 * Spec: docs/what-to-make.md Section 4.1.1 - 認証フロー
 */

import { fetch } from 'undici';
import { webcrypto } from 'node:crypto';
import { canonicalizeJson } from '@remote-apdu/shared';
import type { CardHostPersistedConfig } from './config-manager.js';

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
   * Flow:
   * 1. Send public key + UUID to Router
   * 2. Receive challenge
   * 3. Sign challenge with private key
   * 4. Send signature for verification
   */
  async authenticate(config: CardHostPersistedConfig): Promise<AuthenticationResult> {
    // Step 1: Connect with public key
    const connectPayload = {
      uuid: config.uuid,
      publicKey: config.signingPublicKey
    };

    const connectResponse = await fetch(`${this.routerUrl}/cardhost/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectPayload)
    });

    if (!connectResponse.ok) {
      const error = await connectResponse.text();
      throw new Error(`Connect failed: ${connectResponse.status} - ${error}`);
    }

    const { challenge } = await connectResponse.json() as { challenge: string };

    // Step 2: Sign challenge with Ed25519 private key
    const signature = await this.signChallenge(challenge, config.signingPrivateKey);

    // Step 3: Verify signature with Router
    const verifyPayload = {
      uuid: config.uuid,
      publicKey: config.signingPublicKey,
      signature,
      challenge
    };

    const verifyResponse = await fetch(`${this.routerUrl}/cardhost/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verifyPayload)
    });

    if (!verifyResponse.ok) {
      const error = await verifyResponse.text();
      throw new Error(`Verification failed: ${verifyResponse.status} - ${error}`);
    }

    return {
      authenticated: true,
      challenge
    };
  }

  /**
   * Sign challenge using Ed25519 private key
   * Uses canonical JSON format for consistent signing
   */
  private async signChallenge(challenge: string, privateKeyBase64: string): Promise<string> {
    // Import private key
    const privateKeyDer = Buffer.from(privateKeyBase64, 'base64');
    const privateKey = await webcrypto.subtle.importKey(
      'pkcs8',
      privateKeyDer,
      { name: 'Ed25519' },
      false,
      ['sign']
    );

    // Create canonical payload
    const payload = canonicalizeJson(challenge);

    // Sign
    const signature = await webcrypto.subtle.sign(
      { name: 'Ed25519' },
      privateKey,
      payload
    );

    return Buffer.from(signature).toString('base64');
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