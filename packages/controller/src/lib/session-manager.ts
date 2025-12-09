/**
 * Session Manager for Controller
 * Handles authentication with Router and session token management
 * 
 * Spec: docs/what-to-make.md Section 4.2.1 - 認証フロー
 */

import { fetch } from 'undici';
import type { SessionToken, CardhostInfo } from '@remote-apdu/shared';

export interface SessionManagerConfig {
  routerUrl: string;
  token: string;
}

/**
 * Manages Controller's session with Router
 */
export class SessionManager {
  private sessionToken: string | null = null;
  private expiresAt: Date | null = null;

  constructor(private config: SessionManagerConfig) {}

  /**
   * Authenticate with Router using bearer token
   * Returns session token for subsequent requests
   */
  async authenticate(): Promise<string> {
    // Return cached token if still valid
    if (this.sessionToken && this.expiresAt && this.expiresAt > new Date()) {
      return this.sessionToken;
    }

    const response = await fetch(`${this.config.routerUrl}/controller/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.token}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Authentication failed: ${response.status} - ${error}`);
    }

    const data = await response.json() as SessionToken;
    this.sessionToken = data.token;
    this.expiresAt = new Date(data.expiresAt);

    return this.sessionToken;
  }

  /**
   * List available Cardhosts from Router
   */
  async listCardhosts(): Promise<CardhostInfo[]> {
    const response = await fetch(`${this.config.routerUrl}/cardhosts`, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list cardhosts: ${response.status} - ${error}`);
    }

    return await response.json() as CardhostInfo[];
  }

  /**
   * Create session with specific Cardhost
   * Returns relay ID for WebSocket connection
   */
  async createSession(cardhostUuid: string): Promise<string> {
    const sessionToken = await this.authenticate();

    const response = await fetch(`${this.config.routerUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken
      },
      body: JSON.stringify({ cardhostUuid })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Session creation failed: ${response.status} - ${error}`);
    }

    const { relayId } = await response.json() as { relayId: string };
    return relayId;
  }

  /**
   * Get current session token
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * Check if session is valid
   */
  isSessionValid(): boolean {
    return this.sessionToken !== null && 
           this.expiresAt !== null && 
           this.expiresAt > new Date();
  }

  /**
   * Clear session
   */
  clearSession(): void {
    this.sessionToken = null;
    this.expiresAt = null;
  }
}