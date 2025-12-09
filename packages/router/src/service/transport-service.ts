/**
 * Transport Service
 * Provides transparent, payload-agnostic relay between controller and cardhost
 * 
 * IMPORTANT: This service does NOT parse payloads. It provides transparent
 * transport for E2E encrypted communication. The router should never inspect
 * or decrypt the payload content.
 */

import { ConnectionRepository, type ConnectionData } from "../repository/connection-repository.js";

export interface PendingRequest {
  resolve: (data: unknown) => void;
  timer: NodeJS.Timeout;
}

export class TransportService {
  private readonly REQUEST_TIMEOUT_MS = 30_000;
  
  // Pending responses keyed by `${sessionToken}:${messageId}`
  private pendingResponses = new Map<string, PendingRequest>();

  constructor(private connectionRepo: ConnectionRepository) {}

  /**
   * Register controller connection
   */
  registerController(sessionToken: string, send: (data: unknown) => void): void {
    const connection: ConnectionData = {
      id: `ctrl-${Date.now()}`,
      sessionToken,
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      send,
    };
    this.connectionRepo.registerController(sessionToken, connection);
  }

  /**
   * Register cardhost connection
   */
  registerCardhost(cardhostUuid: string, send: (data: unknown) => void): void {
    const connection: ConnectionData = {
      id: `ch-${Date.now()}`,
      cardhostUuid,
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      send,
    };
    this.connectionRepo.registerCardhost(cardhostUuid, connection);
  }

  /**
   * Unregister controller connection
   */
  unregisterController(sessionToken: string): void {
    this.connectionRepo.unregisterController(sessionToken);
  }

  /**
   * Unregister cardhost connection
   */
  unregisterCardhost(cardhostUuid: string): void {
    this.connectionRepo.unregisterCardhost(cardhostUuid);
  }

  /**
   * Relay data from controller to cardhost
   * This is payload-agnostic - we don't parse the data
   */
  async relayToCardhost(
    sessionToken: string,
    cardhostUuid: string,
    data: unknown,
  ): Promise<unknown> {
    const cardhostConn = this.connectionRepo.getCardhost(cardhostUuid);
    
    if (!cardhostConn) {
      throw new Error("Cardhost not connected");
    }

    // Update activity
    this.connectionRepo.updateControllerActivity(sessionToken);
    this.connectionRepo.updateCardhostActivity(cardhostUuid);

    // Extract message ID if available (for correlation, but we don't parse the payload)
    // We assume the outer envelope has an 'id' field for request/response correlation
    const messageId = this.extractMessageId(data);
    if (!messageId) {
      throw new Error("Message must have an 'id' field for correlation");
    }

    const key = `${sessionToken}:${messageId}`;

    // Check for duplicate
    if (this.pendingResponses.has(key)) {
      throw new Error("Duplicate message ID");
    }

    // Forward to cardhost and await response
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(key);
        reject(new Error("Transport timeout"));
      }, this.REQUEST_TIMEOUT_MS);

      this.pendingResponses.set(key, { resolve, timer });

      try {
        cardhostConn.send(data);
      } catch (error) {
        clearTimeout(timer);
        this.pendingResponses.delete(key);
        reject(new Error(`Send failed: ${error}`));
      }
    });
  }

  /**
   * Relay data from cardhost to controller
   * This is payload-agnostic - we don't parse the data
   */
  relayToController(sessionToken: string, data: unknown): void {
    const controllerConn = this.connectionRepo.getController(sessionToken);
    
    if (!controllerConn) {
      throw new Error("Controller not connected");
    }

    // Update activity
    this.connectionRepo.updateControllerActivity(sessionToken);

    controllerConn.send(data);
  }

  /**
   * Handle incoming data from cardhost
   * Resolves pending promises for request/response correlation
   */
  handleCardhostData(sessionToken: string, data: unknown): void {
    const messageId = this.extractMessageId(data);
    if (!messageId) {
      // Not a response we're waiting for, might be an event
      // For now, just ignore unknown messages
      return;
    }

    const key = `${sessionToken}:${messageId}`;
    const pending = this.pendingResponses.get(key);
    
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingResponses.delete(key);
      pending.resolve(data);
    }
  }

  /**
   * Extract message ID from data without parsing the full payload
   * We only look at the envelope level, not the encrypted payload
   */
  private extractMessageId(data: unknown): string | null {
    if (typeof data === "object" && data !== null && "id" in data) {
      const id = (data as Record<string, unknown>).id;
      return typeof id === "string" ? id : null;
    }
    return null;
  }

  /**
   * Send data to cardhost (for notifications, not request/response)
   */
  sendToCardhost(cardhostUuid: string, data: unknown): void {
    const cardhostConn = this.connectionRepo.getCardhost(cardhostUuid);
    
    if (!cardhostConn) {
      throw new Error("Cardhost not connected");
    }

    cardhostConn.send(data);
  }

  /**
   * Get connection counts
   */
  getConnectionCounts(): { controllers: number; cardhosts: number } {
    return this.connectionRepo.getCounts();
  }

  /**
   * Clear all pending requests
   */
  clearPendingRequests(): void {
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingResponses.clear();
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.clearPendingRequests();
    this.connectionRepo.clear();
  }
}