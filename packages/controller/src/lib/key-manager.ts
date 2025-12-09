/**
 * Key Manager for Controller
 * Handles Ed25519 keypair generation, persistence, and loading
 * 
 * NEW API (2025-12-09): Controller authentication via Ed25519 public key
 * Spec: docs/api-changes-2025-12-09.md Section 6.1
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { createLogger } from "@remote-apdu/shared";

const logger = createLogger("controller:keys");

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

const KEY_DIR = join(homedir(), ".controller");
const PUBLIC_KEY_PATH = join(KEY_DIR, "id_ed25519.pub");
const PRIVATE_KEY_PATH = join(KEY_DIR, "id_ed25519");

/**
 * Manages Controller's Ed25519 keypair
 * Ensures keypair survives restarts and provides consistent identity
 */
export class KeyManager {
  private keyPair: ControllerKeyPair | null = null;

  constructor(
    private keyDir: string = KEY_DIR,
    private publicKeyPath: string = PUBLIC_KEY_PATH,
    private privateKeyPath: string = PRIVATE_KEY_PATH,
  ) {}

  /**
   * Load existing keypair or generate new one
   */
  async loadOrGenerate(): Promise<ControllerKeyPair> {
    if (this.keyPair) {
      logger.debug("Using cached keypair");
      return this.keyPair;
    }

    this.ensureKeyDir();

    if (existsSync(this.publicKeyPath) && existsSync(this.privateKeyPath)) {
      logger.info("Loading existing keypair", { keyDir: this.keyDir });
      return this.loadExisting();
    }

    logger.info("Generating new keypair", { keyDir: this.keyDir });
    return this.generateNew();
  }

  /**
   * Load existing keypair from disk
   */
  private async loadExisting(): Promise<ControllerKeyPair> {
    try {
      const publicKey = readFileSync(this.publicKeyPath, "utf8").trim();
      const privateKeyBase64 = readFileSync(this.privateKeyPath, "utf8").trim();

      // Import private key
      const privateKeyDer = Buffer.from(privateKeyBase64, "base64");
      const privateKey = await webcrypto.subtle.importKey(
        "pkcs8",
        privateKeyDer,
        { name: "Ed25519" },
        false,
        ["sign"],
      );

      this.keyPair = {
        publicKey,
        privateKey,
        privateKeyBase64,
      };

      return this.keyPair;
    } catch (error) {
      throw new Error(
        `Failed to load keypair: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Generate new Ed25519 keypair and save to disk
   */
  private async generateNew(): Promise<ControllerKeyPair> {
    try {
      // Generate Ed25519 keypair
      const keyPair = (await webcrypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;

      // Export keys
      const publicKeySpki = await webcrypto.subtle.exportKey(
        "spki",
        keyPair.publicKey,
      );
      const privateKeyPkcs8 = await webcrypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey,
      );

      const publicKey = Buffer.from(publicKeySpki).toString("base64");
      const privateKeyBase64 = Buffer.from(privateKeyPkcs8).toString("base64");

      // Save to disk with restricted permissions
      writeFileSync(this.publicKeyPath, publicKey, { mode: 0o644 });
      writeFileSync(this.privateKeyPath, privateKeyBase64, { mode: 0o600 });

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
   * Sign challenge using Ed25519 private key
   * Uses canonical JSON format for consistent signing
   */
  async signChallenge(challenge: string): Promise<string> {
    if (!this.keyPair) {
      throw new Error("Keypair not loaded. Call loadOrGenerate() first.");
    }

    // Canonical JSON payload (matches Router's verification)
    const payload = Buffer.from(JSON.stringify(challenge), "utf8");

    const signature = await webcrypto.subtle.sign(
      { name: "Ed25519" },
      this.keyPair.privateKey,
      payload,
    );

    return Buffer.from(signature).toString("base64");
  }

  /**
   * Get public key
   */
  getPublicKey(): string {
    if (!this.keyPair) {
      throw new Error("Keypair not loaded. Call loadOrGenerate() first.");
    }
    return this.keyPair.publicKey;
  }

  /**
   * Verify Router-derived Controller ID matches public key hash
   * Prevents man-in-the-middle attacks
   */
  async verifyControllerId(
    controllerId: string,
    publicKey: string,
  ): Promise<void> {
    logger.debug("Verifying Controller ID", { controllerId });
    
    const publicKeyBytes = Buffer.from(publicKey, "base64");
    const hashBuffer = await webcrypto.subtle.digest("SHA-256", publicKeyBytes);
    
    const base64 = Buffer.from(hashBuffer).toString("base64");
    const base64url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    
    const expectedId = `peer_${base64url}`;
    
    if (controllerId !== expectedId) {
      logger.error("Controller ID verification failed", undefined, {
        received: controllerId,
        expected: expectedId,
      });
      throw new Error(
        `Controller ID verification failed: Router returned ${controllerId} but expected ${expectedId}. ` +
        `Possible man-in-the-middle attack or Router implementation error.`
      );
    }
    
    logger.info("Controller ID verified", { controllerId });
  }

  /**
   * Ensure key directory exists with proper permissions
   */
  private ensureKeyDir(): void {
    if (!existsSync(this.keyDir)) {
      mkdirSync(this.keyDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Clear cached keypair (for testing)
   */
  clear(): void {
    this.keyPair = null;
  }
}