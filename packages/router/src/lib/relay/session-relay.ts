/**
 * Session Relay Manager for Router
 * Bridges Controller and Cardhost connections for APDU relay
 * 
 * Spec: docs/what-to-make.md Section 3.3.3 - 通信中継
 */

import { generateRandomBase64 } from '@remote-apdu/shared';
import type { RpcRequest, RpcResponse } from '@aokiapp/jsapdu-over-ip';

export interface RelaySession {
  relayId: string;
  controllerSessionToken: string;
  cardhostUuid: string;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface ConnectionInfo {
  id: string;
  role: 'controller' | 'cardhost';
  identifier: string; // session token for controller, uuid for cardhost
  relayId?: string;
  onMessage?: (data: unknown) => void;
  send?: (data: unknown) => void;
}

/**
 * Manages relay sessions between Controllers and Cardhosts
 * Routes RPC messages through the relay
 */
export class SessionRelay {
  private relaySessions: Map<string, RelaySession> = new Map();
  private controllerConnections: Map<string, ConnectionInfo> = new Map(); // key: sessionToken
  private cardhostConnections: Map<string, ConnectionInfo> = new Map(); // key: cardhostUuid
  private initialized = false;

  /**
   * Initialize relay service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Session relay already initialized');
    }

    this.initialized = true;
  }

  /**
   * Shutdown relay service
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    // Clear all sessions and connections
    this.relaySessions.clear();
    this.controllerConnections.clear();
    this.cardhostConnections.clear();

    this.initialized = false;
  }

  /**
   * Create relay session linking Controller and Cardhost
   */
  createSession(
    controllerSessionToken: string,
    cardhostUuid: string
  ): string {
    if (!this.initialized) {
      throw new Error('Session relay not initialized');
    }

    const relayId = generateRandomBase64(16);
    const now = new Date();

    const session: RelaySession = {
      relayId,
      controllerSessionToken,
      cardhostUuid,
      createdAt: now,
      lastActivityAt: now
    };

    this.relaySessions.set(relayId, session);

    return relayId;
  }

  /**
   * Get relay session
   */
  getSession(relayId: string): RelaySession | undefined {
    return this.relaySessions.get(relayId);
  }

  /**
   * Register Controller connection
   */
  registerControllerConnection(
    sessionToken: string,
    connectionInfo: ConnectionInfo
  ): void {
    this.controllerConnections.set(sessionToken, connectionInfo);
  }

  /**
   * Register Cardhost connection
   */
  registerCardhostConnection(
    cardhostUuid: string,
    connectionInfo: ConnectionInfo
  ): void {
    this.cardhostConnections.set(cardhostUuid, connectionInfo);
  }

  /**
   * Unregister Controller connection
   */
  unregisterController(sessionToken: string): void {
    this.controllerConnections.delete(sessionToken);
  }

  /**
   * Unregister Cardhost connection
   */
  unregisterCardhost(cardhostUuid: string): void {
    this.cardhostConnections.delete(cardhostUuid);
  }

  /**
   * Relay RPC request from Controller to Cardhost
   */
  async relayToCardhost(
    controllerSessionToken: string,
    request: RpcRequest
  ): Promise<RpcResponse> {
    // Find relay session
    let relaySession: RelaySession | undefined;
    for (const session of this.relaySessions.values()) {
      if (session.controllerSessionToken === controllerSessionToken) {
        relaySession = session;
        break;
      }
    }

    if (!relaySession) {
      return {
        id: request.id,
        error: {
          code: 'NO_RELAY_SESSION',
          message: 'No relay session found for this controller'
        }
      };
    }

    // Get Cardhost connection
    const cardhostConn = this.cardhostConnections.get(relaySession.cardhostUuid);
    if (!cardhostConn) {
      return {
        id: request.id,
        error: {
          code: 'CARDHOST_OFFLINE',
          message: 'Cardhost is not connected'
        }
      };
    }

    // Forward request to Cardhost
    // In a real implementation with WebSocket, this would use the connection's send method
    // For now, return a placeholder response
    return {
      id: request.id,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'RPC relay not yet implemented'
      }
    };
  }

  /**
   * Relay RPC response from Cardhost to Controller
   */
  async relayToController(
    cardhostUuid: string,
    response: RpcResponse
  ): Promise<void> {
    // Find relay session
    let relaySession: RelaySession | undefined;
    for (const session of this.relaySessions.values()) {
      if (session.cardhostUuid === cardhostUuid) {
        relaySession = session;
        break;
      }
    }

    if (!relaySession) {
      throw new Error('No relay session found for this cardhost');
    }

    // Get Controller connection
    const controllerConn = this.controllerConnections.get(
      relaySession.controllerSessionToken
    );
    
    if (!controllerConn?.send) {
      throw new Error('Controller not connected');
    }

    // Forward response to Controller
    controllerConn.send(response);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(relayId: string): void {
    const session = this.relaySessions.get(relayId);
    if (session) {
      session.lastActivityAt = new Date();
    }
  }

  /**
   * Cleanup inactive sessions
   */
  cleanupInactiveSessions(maxIdleMs: number = 30 * 60 * 1000): void {
    const now = new Date();
    for (const [relayId, session] of this.relaySessions.entries()) {
      const idleMs = now.getTime() - session.lastActivityAt.getTime();
      if (idleMs > maxIdleMs) {
        this.relaySessions.delete(relayId);
      }
    }
  }

  /**
   * Get active relay count
   */
  getActiveRelayCount(): number {
    return this.relaySessions.size;
  }

  /**
   * Get connection counts
   */
  getConnectionCounts(): { controllers: number; cardhosts: number } {
    return {
      controllers: this.controllerConnections.size,
      cardhosts: this.cardhostConnections.size
    };
  }
}