/**
 * Router Service - Core Library
 * Manages authentication and relay between Controllers and Cardhosts
 * Provides testable, composable Router functionality
 *
 * Spec: docs/what-to-make.md Section 3.3 - Router
 */

import { ControllerAuth } from "./auth/controller-auth.js";
import { CardhostAuth } from "./auth/cardhost-auth.js";
import { SessionRelay } from "./relay/session-relay.js";
import type {
  SessionToken,
  CardhostInfo,
  RouterConfig,
} from "@remote-apdu/shared";

/**
 * Router Service
 *
 * This is the library core - fully testable without HTTP server.
 *
 * Usage:
 * ```typescript
 * const router = new RouterService({ port: 3000 });
 * await router.start();
 *
 * // Authenticate Controller
 * const sessionToken = await router.authenticateController('bearer-token');
 *
 * // Authenticate Cardhost
 * const challenge = await router.initiateCardhostAuth(uuid, publicKey);
 * await router.verifyCardhostAuth(uuid, challenge, signature);
 *
 * // Create relay session
 * const relayId = router.createRelaySession(sessionToken, uuid);
 *
 * await router.stop();
 * ```
 */
export class RouterService {
  private controllerAuth: ControllerAuth;
  private cardhostAuth: CardhostAuth;
  private sessionRelay: SessionRelay;
  private running = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private config: RouterConfig = {},
    controllerAuth?: ControllerAuth,
    cardhostAuth?: CardhostAuth,
    sessionRelay?: SessionRelay,
  ) {
    // Use provided or create new auth managers
    this.controllerAuth = controllerAuth ?? new ControllerAuth();
    this.cardhostAuth = cardhostAuth ?? new CardhostAuth();
    this.sessionRelay = sessionRelay ?? new SessionRelay();
  }

  /**
   * Start Router service
   * Initializes relay and starts cleanup tasks
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Router already running");
    }

    await this.sessionRelay.initialize();

    // Start periodic cleanup of expired challenges and sessions
    this.cleanupInterval = setInterval(() => {
      this.controllerAuth.cleanupExpiredSessions();
      this.cardhostAuth.cleanupExpiredChallenges();
      this.sessionRelay.cleanupInactiveSessions();
    }, 60 * 1000); // Every minute

    this.running = true;
  }

  /**
   * Stop Router service
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    await this.sessionRelay.shutdown();
    this.running = false;
  }

  /**
   * Authenticate Controller with bearer token
   * Returns session token for subsequent requests
   */
  async authenticateController(bearerToken: string): Promise<SessionToken> {
    return this.controllerAuth.authenticate(bearerToken);
  }

  /**
   * Validate Controller session token
   */
  validateControllerSession(sessionToken: string): boolean {
    return this.controllerAuth.validateSession(sessionToken) !== null;
  }

  /**
   * Initiate Cardhost authentication (Step 1: issue challenge)
   */
  async initiateCardhostAuth(uuid: string, publicKey: string): Promise<string> {
    return this.cardhostAuth.initiateAuth(uuid, publicKey);
  }

  /**
   * Verify Cardhost authentication (Step 2: verify signature)
   */
  async verifyCardhostAuth(
    uuid: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    return this.cardhostAuth.verifyAuth(uuid, challenge, signature);
  }

  /**
   * Check if Cardhost is connected
   */
  isCardhostConnected(uuid: string): boolean {
    return this.cardhostAuth.isConnected(uuid);
  }

  /**
   * Create relay session between Controller and Cardhost
   */
  createRelaySession(
    controllerSessionToken: string,
    cardhostUuid: string,
  ): string {
    // Validate controller session
    if (!this.validateControllerSession(controllerSessionToken)) {
      throw new Error("Invalid or expired controller session");
    }

    // Validate cardhost is connected
    if (!this.isCardhostConnected(cardhostUuid)) {
      throw new Error("Cardhost not connected");
    }

    return this.sessionRelay.createSession(
      controllerSessionToken,
      cardhostUuid,
    );
  }

  /**
   * List connected Cardhosts
   */
  listCardhosts(): CardhostInfo[] {
    return this.cardhostAuth.listCardhosts();
  }

  /**
   * Get relay for RPC forwarding
   */
  getSessionRelay(): SessionRelay {
    return this.sessionRelay;
  }

  /**
   * Get Controller auth manager (for WebSocket handler)
   */
  getControllerAuth(): ControllerAuth {
    return this.controllerAuth;
  }

  /**
   * Get Cardhost auth manager (for WebSocket handler)
   */
  getCardhostAuth(): CardhostAuth {
    return this.cardhostAuth;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get service statistics
   */
  getStats(): {
    running: boolean;
    activeControllers: number;
    activeCardhosts: number;
    activeSessions: number;
    connectedCardhosts: number;
  } {
    const connections = this.sessionRelay.getConnectionCounts();

    return {
      running: this.running,
      activeControllers: this.controllerAuth.getActiveSessionCount(),
      activeCardhosts: connections.cardhosts,
      activeSessions: this.sessionRelay.getActiveRelayCount(),
      connectedCardhosts: this.listCardhosts().filter((c) => c.connected)
        .length,
    };
  }
}
