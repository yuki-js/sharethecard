/**
 * Key Manager for Controller
 * Handles Ed25519 keypair generation, persistence, and loading.
 * This class is environment-agnostic and relies on an injected IKeyStore
 * for persistence.
 */
import {
  createLogger,
  toBase64,
  fromBase64,
  prepareSigningPayload,
  deriveIdFromPublicKeyHash,
} from "@remote-apdu/shared";

import { exportEd25519KeyPair } from "./crypto-utils.js";
import type { IKeyStore } from "./store/interface.js";

const crypto = globalThis.crypto;
const logger = createLogger("controller:keys");

const PUBLIC_KEY_NAME = "id_ed25519.pub";
const PRIVATE_KEY_NAME = "id_ed25519";

export interface ControllerKeyPair {
  publicKey: string; // SPKI format, base64-encoded
  privateKey: CryptoKey; // In-memory only
  privateKeyBase64: string; // PKCS8 format, base64-encoded (for persistence)
}

export interface ControllerIdentity {
  controllerId: string; // Router-derived ID (peer_<hash>)
  publicKey: string;
  privateKey: CryptoKey;
}

/**
 * Manages Controller's Ed25519 keypair.
 * Ensures keypair survives restarts and provides consistent identity by using
 * a persistent key store.
 */
export class KeyManager {
  private keyPair: ControllerKeyPair | null = null;

  constructor(private keyStore: IKeyStore) {}

  /**
   * Load existing keypair from the key store or generate a new one.
   */
  async loadOrGenerate(): Promise<ControllerKeyPair> {
    if (this.keyPair) {
      logger.debug("Using cached keypair");
      return this.keyPair;
    }

    if (
      (await this.keyStore.exists(PUBLIC_KEY_NAME)) &&
      (await this.keyStore.exists(PRIVATE_KEY_NAME))
    ) {
      logger.info("Loading existing keypair from store");
      return this.loadExisting();
    }

    logger.info("Generating new keypair");
    return this.generateNew();
  }

  /**
   * Load existing keypair from the key store.
   */
  private async loadExisting(): Promise<ControllerKeyPair> {
    try {
      const publicKey = (await this.keyStore.load(PUBLIC_KEY_NAME))!;
      const privateKeyBase64 = (await this.keyStore.load(PRIVATE_KEY_NAME))!;

      // Import private key
      const privateKeyDer = fromBase64(privateKeyBase64);
      const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyDer.buffer as ArrayBuffer,
        { name: "Ed25519" },
        false,
        ["sign"],
      );

      this.keyPair = {
        publicKey: publicKey.trim(),
        privateKey,
        privateKeyBase64: privateKeyBase64.trim(),
      };

      return this.keyPair;
    } catch (error) {
      throw new Error(
        `Failed to load keypair from store: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Generate new Ed25519 keypair and save to the key store.
   */
  private async generateNew(): Promise<ControllerKeyPair> {
    try {
      // Generate Ed25519 keypair
      const keyPair = (await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;

      // Export keys
      const { publicKey, privateKey: privateKeyBase64 } = await exportEd25519KeyPair(
        keyPair,
      );

      // Save to persistent store
      await this.keyStore.save(PUBLIC_KEY_NAME, publicKey);
      await this.keyStore.save(PRIVATE_KEY_NAME, privateKeyBase64);

      this.keyPair = {
        publicKey,
        privateKey: keyPair.privateKey,
        privateKeyBase64,
      };

      return this.keyPair;
    } catch (error) {
      throw new Error(
        `Failed to generate keypair: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Sign challenge using Ed25519 private key.
   * Uses canonical JSON format for consistent signing.
   */
  async signChallenge(challenge: string): Promise<string> {
    if (!this.keyPair) {
      throw new Error("Keypair not loaded. Call loadOrGenerate() first.");
    }

    // Canonical JSON payload (matches Router's verification)
    const payload = prepareSigningPayload(challenge);

    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      this.keyPair.privateKey,
      payload.buffer as ArrayBuffer,
    );

    return toBase64(new Uint8Array(signature));
  }

  /**
   * Get public key.
   */
  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error("Keypair not loaded. Call loadOrGenerate() first.");
    }
    return this.keyPair.publicKey;
  }

  /**
   * Get private key (base64-encoded PKCS8).
   */
  getPrivateKey(): string {
    if (!this.keyPair) {
      throw new Error("Keypair not loaded. Call loadOrGenerate() first.");
    }
    return this.keyPair.privateKeyBase64;
  }

  /**
   * Verify Router-derived Controller ID matches public key hash.
   * Prevents man-in-the-middle attacks.
   */
  async verifyControllerId(
    controllerId: string,
    publicKey: string,
  ): Promise<void> {
    logger.debug("Verifying Controller ID", { controllerId });

    const expectedId = await deriveIdFromPublicKeyHash(publicKey);

    if (controllerId !== expectedId) {
      logger.error("Controller ID verification failed", undefined, {
        received: controllerId,
        expected: expectedId,
      });
      throw new Error(
        `Controller ID verification failed: Router returned ${controllerId} but expected ${expectedId}. ` +
          `Possible man-in-the-middle attack or Router implementation error.`,
      );
    }

    logger.info("Controller ID verified", { controllerId });
  }

  /**
   * Clear cached keypair (for testing).
   */
  clear(): void {
    this.keyPair = null;
  }
}