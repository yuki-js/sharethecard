/**
 * Transport Use Case
 * Business logic for transparent data relay between controller and cardhost
 */

import { TransportService } from "../service/transport-service.js";
import { SessionService } from "../service/session-service.js";

export class TransportUseCase {
  constructor(
    private transportService: TransportService,
    private sessionService: SessionService,
  ) {}

  /**
   * Relay data from controller to cardhost
   * Session token is used to identify the associated cardhost
   */
  async relayFromController(
    sessionToken: string,
    data: unknown,
  ): Promise<unknown> {
    // Get session to find associated cardhost
    const session = this.sessionService.validateSession(sessionToken);
    if (!session) {
      throw new Error("Invalid or expired session token");
    }

    if (!session.cardhostUuid) {
      throw new Error("No cardhost associated with this session");
    }

    // Update activity
    this.sessionService.updateActivity(sessionToken);

    // Relay transparently
    return await this.transportService.relayToCardhost(
      sessionToken,
      session.cardhostUuid,
      data,
    );
  }

  /**
   * Relay data from cardhost to controller
   */
  relayFromCardhost(cardhostUuid: string, data: unknown): void {
    // Find session for this cardhost
    const session = this.sessionService.findByCardhostUuid(cardhostUuid);
    if (!session) {
      throw new Error("No active session for this cardhost");
    }

    // Relay transparently
    this.transportService.relayToController(session.sessionToken, data);
  }

  /**
   * Handle incoming data from cardhost (for request/response correlation)
   */
  handleCardhostData(cardhostUuid: string, data: unknown): void {
    const session = this.sessionService.findByCardhostUuid(cardhostUuid);
    if (session) {
      this.transportService.handleCardhostData(session.sessionToken, data);
    }
  }

  /**
   * Register controller connection
   */
  registerController(sessionToken: string, send: (data: unknown) => void): void {
    this.transportService.registerController(sessionToken, send);
  }

  /**
   * Register cardhost connection
   */
  registerCardhost(cardhostUuid: string, send: (data: unknown) => void): void {
    this.transportService.registerCardhost(cardhostUuid, send);
  }

  /**
   * Unregister controller connection
   */
  unregisterController(sessionToken: string): void {
    this.transportService.unregisterController(sessionToken);
  }

  /**
   * Unregister cardhost connection
   */
  unregisterCardhost(cardhostUuid: string): void {
    this.transportService.unregisterCardhost(cardhostUuid);
  }

  /**
   * Get connection counts
   */
  getConnectionCounts(): { controllers: number; cardhosts: number } {
    return this.transportService.getConnectionCounts();
  }
}