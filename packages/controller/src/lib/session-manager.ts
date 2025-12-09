/**
 * Session Manager for Controller
 * Handles authentication with Router and session token management
 *
 * NEW API (2025-12-09): Ed25519 public key authentication
 * Spec: docs/api-changes-2025-12-09.md Section 2
 */

import { fetch } from "undici";
import { createLogger } from "@remote-apdu/shared";
import type { SessionToken, CardhostInfo } from "@remote-apdu/shared";
import { KeyManager } from "./key-manager.js";

const logger = createLogger("controller:session");

export interface SessionManagerConfig {
  routerUrl: string;
  keyManager?: KeyManager; // Optional for testing
}

/**
 * Manages Controller's session with Router
 *
 * NEW AUTHENTICATION FLOW:
 * 1. Initiate auth with public key → get Controller ID + challenge
 * 2. Sign challenge and verify → complete authentication
 * 3. Create session with cardhost UUID → get session token
 */
export class SessionManager {
  private keyManager: KeyManager;
  private controllerId: string | null = null;
  private sessionToken: string | null = null;
  private expiresAt: Date | null = null;
  private authenticated = false;

  constructor(private config: SessionManagerConfig) {
    this.keyManager = config.keyManager ?? new KeyManager();
  }

  /**
   * Authenticate with Router using Ed25519 keypair
   *
   * NEW 3-STEP FLOW:
   * 1. POST /controller/auth/initiate with publicKey
   * 2. POST /controller/auth/verify with signature
   * 3. Authentication complete, ready for session creation
   */
  async authenticate(): Promise<string> {
    // Return cached Controller ID if already authenticated
    if (this.authenticated && this.controllerId) {
      logger.debug("Using cached authentication", { controllerId: this.controllerId });
      return this.controllerId;
    }

    logger.info("Starting authentication", { routerUrl: this.config.routerUrl });

    // Load or generate keypair
    await this.keyManager.loadOrGenerate();
    const publicKey = this.keyManager.getPublicKey();

    // Step 1: Initiate authentication
    logger.debug("Initiating authentication", { operation: "auth-initiate" });
    const initiateResponse = await fetch(
      `${this.config.routerUrl}/controller/auth/initiate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicKey }),
      },
    );

    if (!initiateResponse.ok) {
      const error = await initiateResponse.text();
      logger.error("Authentication initiation failed", new Error(error), {
        status: initiateResponse.status,
      });
      throw new Error(
        `Authentication initiation failed: ${initiateResponse.status} - ${error}`,
      );
    }

    const { controllerId, challenge } = (await initiateResponse.json()) as {
      controllerId: string;
      challenge: string;
    };
    
    logger.debug("Received Controller ID", { controllerId });

    // Verify Router-derived Controller ID (security check)
    await this.keyManager.verifyControllerId(controllerId, publicKey);

    // Step 2: Sign challenge
    logger.debug("Signing challenge", { operation: "sign-challenge" });
    const signature = await this.keyManager.signChallenge(challenge);

    // Step 3: Verify authentication
    logger.debug("Verifying authentication", { operation: "auth-verify" });
    const verifyResponse = await fetch(
      `${this.config.routerUrl}/controller/auth/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controllerId, challenge, signature }),
      },
    );

    if (!verifyResponse.ok) {
      const error = await verifyResponse.text();
      logger.error("Authentication verification failed", new Error(error), {
        status: verifyResponse.status,
      });
      throw new Error(
        `Authentication verification failed: ${verifyResponse.status} - ${error}`,
      );
    }

    this.controllerId = controllerId;
    this.authenticated = true;

    logger.info("Authentication successful", { controllerId });
    return controllerId;
  }

  /**
   * List available Cardhosts from Router
   *
   * NEW: Uses Controller ID for authentication (not bearer token)
   */
  async listCardhosts(): Promise<CardhostInfo[]> {
    const controllerId = await this.authenticate();

    const response = await fetch(
      `${this.config.routerUrl}/controller/cardhosts`,
      {
        headers: {
          "x-controller-id": controllerId,
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to list cardhosts: ${response.status} - ${error}`,
      );
    }

    return (await response.json()) as CardhostInfo[];
  }

  /**
   * Create session with specific Cardhost
   *
   * NEW API:
   * - Endpoint: POST /controller/sessions
   * - Body: { controllerId, cardhostUuid }
   * - Returns: { token, expiresAt }
   */
  async createSession(cardhostUuid: string): Promise<string> {
    const controllerId = await this.authenticate();

    logger.info("Creating session", { controllerId, cardhostUuid });
    const response = await fetch(
      `${this.config.routerUrl}/controller/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ controllerId, cardhostUuid }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error("Session creation failed", new Error(error), {
        status: response.status,
      });
      throw new Error(`Session creation failed: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as SessionToken;
    this.sessionToken = data.token;
    this.expiresAt = new Date(data.expiresAt);

    logger.info("Session created", { expiresAt: data.expiresAt });
    return this.sessionToken;
  }

  /**
   * Get Controller ID (Router-derived from public key)
   */
  getControllerId(): string | null {
    return this.controllerId;
  }

  /**
   * Get current session token
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated && this.controllerId !== null;
  }

  /**
   * Check if session is valid
   */
  isSessionValid(): boolean {
    return (
      this.sessionToken !== null &&
      this.expiresAt !== null &&
      this.expiresAt > new Date()
    );
  }

  /**
   * Clear session and authentication
   */
  clearSession(): void {
    this.sessionToken = null;
    this.expiresAt = null;
    this.authenticated = false;
    this.controllerId = null;
  }
}
