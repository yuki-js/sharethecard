/**
 * Connection Repository
 * Manages active WebSocket connections for both controllers and cardhosts
 */

export interface ConnectionData {
  id: string;
  sessionToken?: string; // For controller connections
  cardhostUuid?: string; // For cardhost connections
  connectedAt: Date;
  lastActivityAt: Date;
  send: (data: unknown) => void;
}

export class ConnectionRepository {
  // Controller connections keyed by session token
  private controllerConnections = new Map<string, ConnectionData>();
  
  // Cardhost connections keyed by cardhost UUID
  private cardhostConnections = new Map<string, ConnectionData>();

  /**
   * Register controller connection
   */
  registerController(sessionToken: string, connection: ConnectionData): void {
    this.controllerConnections.set(sessionToken, {
      ...connection,
      sessionToken,
      lastActivityAt: new Date(),
    });
  }

  /**
   * Register cardhost connection
   */
  registerCardhost(cardhostUuid: string, connection: ConnectionData): void {
    this.cardhostConnections.set(cardhostUuid, {
      ...connection,
      cardhostUuid,
      lastActivityAt: new Date(),
    });
  }

  /**
   * Get controller connection
   */
  getController(sessionToken: string): ConnectionData | undefined {
    return this.controllerConnections.get(sessionToken);
  }

  /**
   * Get cardhost connection
   */
  getCardhost(cardhostUuid: string): ConnectionData | undefined {
    return this.cardhostConnections.get(cardhostUuid);
  }

  /**
   * Unregister controller connection
   */
  unregisterController(sessionToken: string): boolean {
    return this.controllerConnections.delete(sessionToken);
  }

  /**
   * Unregister cardhost connection
   */
  unregisterCardhost(cardhostUuid: string): boolean {
    return this.cardhostConnections.delete(cardhostUuid);
  }

  /**
   * Update activity timestamp for controller
   */
  updateControllerActivity(sessionToken: string): void {
    const conn = this.controllerConnections.get(sessionToken);
    if (conn) {
      conn.lastActivityAt = new Date();
    }
  }

  /**
   * Update activity timestamp for cardhost
   */
  updateCardhostActivity(cardhostUuid: string): void {
    const conn = this.cardhostConnections.get(cardhostUuid);
    if (conn) {
      conn.lastActivityAt = new Date();
    }
  }

  /**
   * Get counts
   */
  getCounts(): { controllers: number; cardhosts: number } {
    return {
      controllers: this.controllerConnections.size,
      cardhosts: this.cardhostConnections.size,
    };
  }

  /**
   * Clear all connections
   */
  clear(): void {
    this.controllerConnections.clear();
    this.cardhostConnections.clear();
  }
}