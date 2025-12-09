/**
 * Controller Client - Core Library
 * Wraps RemoteSmartCardPlatform from jsapdu-over-ip
 * Provides testable, composable Controller functionality
 * 
 * Spec: docs/what-to-make.md Section 3.1 - Controller
 * Reference: research/jsapdu-over-ip/src/client/platform-proxy.ts
 */

import { RemoteSmartCardPlatform } from '@aokiapp/jsapdu-over-ip/client';
import { CommandApdu, ResponseApdu, SmartCardError } from '@aokiapp/jsapdu-interface';
import { SessionManager } from './session-manager.js';
import { RouterClientTransport } from './router-transport.js';
import type { ControllerConfig, CardhostInfo } from '@remote-apdu/shared';

/**
 * Controller Client
 * 
 * This is the library core - fully testable without CLI.
 * 
 * Usage:
 * ```typescript
 * const client = new ControllerClient({
 *   routerUrl: 'http://router.example.com',
 *   token: 'bearer-token-123'
 * });
 * 
 * await client.connect('cardhost-uuid-here');
 * 
 * // Use jsapdu-interface methods
 * const command = new CommandApdu(0x00, 0xA4, 0x04, 0x00, ...);
 * const response = await client.transmit(command);
 * 
 * await client.disconnect();
 * ```
 * 
 * Also supports `await using`:
 * ```typescript
 * await using client = new ControllerClient(config);
 * await client.connect(uuid);
 * const response = await client.transmit(command);
 * // Auto-cleanup on scope exit
 * ```
 */
export class ControllerClient {
  private platform: RemoteSmartCardPlatform | null = null;
  private transport: RouterClientTransport | null = null;
  private sessionManager: SessionManager;
  private connectedCardhostUuid: string | null = null;

  constructor(private config: ControllerConfig) {
    this.sessionManager = new SessionManager({
      routerUrl: config.routerUrl,
      token: config.token
    });
  }

  /**
   * Connect to Router and establish connection with specific Cardhost
   * 
   * This performs:
   * 1. Bearer token authentication with Router
   * 2. Session creation with target Cardhost
   * 3. RemoteSmartCardPlatform initialization (jsapdu-over-ip)
   * 
   * After connection, the platform can be used like local SmartCardPlatform
   */
  async connect(cardhostUuid?: string): Promise<void> {
    const uuid = cardhostUuid ?? this.config.cardhostUuid;
    if (!uuid) {
      throw new SmartCardError(
        'INVALID_PARAMETER',
        'Cardhost UUID required. Provide via config or parameter.'
      );
    }

    if (this.platform) {
      throw new SmartCardError(
        'ALREADY_CONNECTED',
        'Already connected. Disconnect first.'
      );
    }

    // Authenticate and create session
    const sessionToken = await this.sessionManager.authenticate();
    const relayId = await this.sessionManager.createSession(uuid);

    // Create transport for jsapdu-over-ip
    // The Router's /api/jsapdu/rpc endpoint bridges to the Cardhost
    this.transport = new RouterClientTransport({
      rpcEndpoint: `${this.config.routerUrl}/api/jsapdu/rpc`,
      sessionToken,
      cardhostUuid: uuid
    });

    // Create RemoteSmartCardPlatform (jsapdu-over-ip client)
    // This provides the full jsapdu-interface API over the network
    this.platform = new RemoteSmartCardPlatform(this.transport);
    // Idempotent init: tolerate server-side pre-initialization by forcing init(true)
    // This sets local initialized state and ensures platform is ready for getDeviceInfo().
    await this.platform.init(true);

    this.connectedCardhostUuid = uuid;
  }

  /**
   * List available Cardhosts from Router
   */
  async listCardhosts(): Promise<CardhostInfo[]> {
    return this.sessionManager.listCardhosts();
  }

  /**
   * Get the underlying jsapdu-interface platform
   * 
   * This returns RemoteSmartCardPlatform which is 100% compatible
   * with SmartCardPlatform interface from jsapdu
   * 
   * Use this for advanced operations following jsapdu patterns:
   * ```typescript
   * const platform = client.getPlatform();
   * const devices = await platform.getDeviceInfo();
   * await using device = await platform.acquireDevice(devices[0].id);
   * await using card = await device.startSession();
   * const response = await card.transmit(command);
   * ```
   */
  getPlatform(): RemoteSmartCardPlatform {
    if (!this.platform) {
      throw new SmartCardError(
        'NOT_CONNECTED',
        'Not connected. Call connect() first.'
      );
    }
    return this.platform;
  }

  /**
   * Send APDU command (convenience method)
   * 
   * This is a simplified API that handles the full jsapdu flow:
   * platform → acquireDevice → startSession → transmit
   * 
   * For simple use cases, this is more convenient than calling
   * getPlatform() and managing device/card lifecycle manually.
   */
  async transmit(command: CommandApdu): Promise<ResponseApdu> {
    const platform = this.getPlatform();

    // Follow jsapdu pattern: get device → start session → transmit
    // Use explicit try/finally to avoid suppressed disposal errors in test environments
    const devices = await platform.getDeviceInfo();
    if (devices.length === 0) {
      throw new SmartCardError(
        'NO_READERS',
        'No devices available on Cardhost'
      );
    }

    const device = await platform.acquireDevice(devices[0].id);
    try {
      // Wait for card if not present
      const isPresent = await device.isCardPresent();
      if (!isPresent) {
        throw new SmartCardError(
          'CARD_NOT_PRESENT',
          'Card not present. Insert card and try again.'
        );
      }

      const card = await device.startSession();
      try {
        return await card.transmit(command);
      } finally {
        try {
          await card.release();
        } catch (err) {
          console.warn('[ControllerClient] Card cleanup error:', err);
          // Continue despite cleanup error to avoid masking primary results
        }
      }
    } finally {
      try {
        await device.release();
      } catch (err) {
        console.warn('[ControllerClient] Device cleanup error:', err);
        // Continue despite cleanup error to avoid masking primary results
      }
    }
  }

  /**
   * Disconnect from Router and cleanup resources
   */
  async disconnect(): Promise<void> {
    if (this.platform) {
      await this.platform.release();
      this.platform = null;
    }

    if (this.transport) {
      await this.transport.close?.();
      this.transport = null;
    }

    this.connectedCardhostUuid = null;
  }

  /**
   * Get connected Cardhost UUID
   */
  getConnectedCardhostUuid(): string | null {
    return this.connectedCardhostUuid;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.platform !== null && this.platform.isInitialized();
  }

  /**
   * Async disposal support (await using)
   * 
   * Example:
   * ```typescript
   * await using client = new ControllerClient(config);
   * await client.connect(uuid);
   * // ... use client ...
   * // Automatic cleanup on scope exit
   * ```
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}