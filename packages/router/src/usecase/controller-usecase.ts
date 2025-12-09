/**
 * Controller Use Case
 * Business logic for controller authentication and session management
 * 
 * IMPORTANT: Authentication and identification are now separated:
 * 1. Authentication: Public key challenge-response (via ControllerAuthService)
 * 2. Identification: Session token for cardhost connection (via SessionService)
 */

import { SessionService } from "../service/session-service.js";
import { ControllerAuthService } from "../service/controller-auth-service.js";
import { AuthService } from "../service/auth-service.js";
import type { SessionToken } from "@remote-apdu/shared";

export class ControllerUseCase {
  constructor(
    private controllerAuthService: ControllerAuthService,
    private sessionService: SessionService,
    private cardhostAuthService: AuthService,
  ) {}

  /**
   * Initiate controller authentication
   * Step 1: Derive controller ID from public key, register, and issue challenge
   *
   * Returns both the derived controller ID and the challenge.
   * The controller cannot choose their own ID.
   */
  async initiateAuth(publicKey: string): Promise<{ controllerId: string; challenge: string }> {
    return await this.controllerAuthService.initiateAuth(publicKey);
  }

  /**
   * Verify controller authentication
   * Step 2: Verify signature
   */
  async verifyAuth(
    controllerId: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    return await this.controllerAuthService.verifyAuth(
      controllerId,
      challenge,
      signature,
    );
  }

  /**
   * Check if controller is authenticated
   */
  isAuthenticated(controllerId: string): boolean {
    return this.controllerAuthService.isAuthenticated(controllerId);
  }

  /**
   * Create session for cardhost connection
   * This is for IDENTIFICATION only, not authentication.
   * Controller must be authenticated before calling this.
   */
  createSession(controllerId: string, cardhostUuid: string): SessionToken {
    // Verify controller is authenticated
    if (!this.controllerAuthService.isAuthenticated(controllerId)) {
      throw new Error("Controller not authenticated");
    }

    // Verify cardhost is connected
    if (!this.cardhostAuthService.isCardhostConnected(cardhostUuid)) {
      throw new Error("Cardhost not connected");
    }

    // Create session for identification
    const sessionToken = this.sessionService.createSession(controllerId);

    // Associate cardhost with session
    if (!this.sessionService.associateCardhost(sessionToken.token, cardhostUuid)) {
      throw new Error("Failed to create relay session");
    }

    return sessionToken;
  }

  /**
   * Validate session token (identification check, not authentication)
   */
  validateSession(sessionToken: string): boolean {
    return this.sessionService.validateSession(sessionToken) !== null;
  }

  /**
   * Get cardhost UUID for session
   */
  getCardhostForSession(sessionToken: string): string | undefined {
    const session = this.sessionService.validateSession(sessionToken);
    return session?.cardhostUuid;
  }

  /**
   * Get controller ID for session
   */
  getControllerForSession(sessionToken: string): string | undefined {
    const session = this.sessionService.validateSession(sessionToken);
    return session?.controllerId;
  }

  /**
   * Revoke session
   */
  revokeSession(sessionToken: string): void {
    this.sessionService.revokeSession(sessionToken);
  }

  /**
   * Disconnect controller
   */
  disconnect(controllerId: string): void {
    this.controllerAuthService.disconnectController(controllerId);
  }
}