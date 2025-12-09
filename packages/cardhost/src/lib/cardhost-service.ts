/**
 * Cardhost Service - Core Library
 * Wraps SmartCardPlatform with jsapdu-over-ip ServerTransport
 * Provides testable, composable Cardhost functionality
 *
 * Spec: docs/what-to-make.md Section 3.2 - Cardhost
 * Reference: research/jsapdu-over-ip/src/server/platform-adapter.ts
 */

import { SmartCardPlatformAdapter } from "@aokiapp/jsapdu-over-ip/server";
import type { SmartCardPlatform } from "@aokiapp/jsapdu-interface";
import { SmartCardError } from "@aokiapp/jsapdu-interface";
import { ConfigManager } from "./config-manager.js";
import { AuthManager } from "./auth-manager.js";
import { RouterServerTransport } from "./router-transport.js";
import { MockSmartCardPlatform } from "./mock-platform.js";

export interface CardhostServiceConfig {
  routerUrl: string;
  platform: SmartCardPlatform;
  configManager: ConfigManager;
  authManager?: AuthManager;
}

/**
 * Cardhost Service
 *
 * This is the library core - fully testable without running as standalone service.
 *
 * Usage:
 * ```typescript
 * // With real hardware
 * const service = new CardhostService({ routerUrl: 'http://router.example.com' });
 *
 * // With mock platform (for testing)
 * const mockPlatform = new MockSmartCardPlatform();
 * const service = new CardhostService({
 *   routerUrl: 'http://localhost:3000',
 *   platform: mockPlatform
 * });
 *
 * await service.connect();
 * // Now Controller can send APDU commands via Router
 *
 * await service.disconnect();
 * ```
 */
export class CardhostService {
  private platform: SmartCardPlatform;
  private adapter: SmartCardPlatformAdapter | null = null;
  private transport: RouterServerTransport | null = null;
  private configManager: ConfigManager;
  private authManager: AuthManager;
  private connected = false;

  constructor(config: CardhostServiceConfig) {
    this.platform = config.platform;
    this.configManager = config.configManager;
    this.authManager = config.authManager ?? new AuthManager(config.routerUrl);
  }

  /**
   * Connect to Router and start serving APDU requests
   *
   * Steps:
   * 1. Load or create UUID and keypair
   * 2. Authenticate with Router (challenge-response)
   * 3. Initialize platform
   * 4. Create transport and adapter
   * 5. Start serving RPC requests
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new SmartCardError("ALREADY_CONNECTED", "Already connected");
    }

    // Load/create config (UUID + keypair)
    let config = await this.configManager.loadOrCreate(
      this.authManager.getRouterUrl(),
    );

    // Ensure persisted routerUrl matches the active runtime URL (e.g., test port)
    if (config.routerUrl !== this.authManager.getRouterUrl()) {
      await this.configManager.updateRouterUrl(this.authManager.getRouterUrl());
      // Refresh local config and auth manager to use the updated router URL
      config = this.configManager.getConfig();
      this.authManager.setRouterUrl(config.routerUrl);
    }

    // Authenticate with Router
    await this.authManager.authenticate(config);

    // Lazy initialization: platform will be initialized by Controller via jsapdu-over-ip 'init' RPC.
    // Avoid double-initialization here to prevent RemoteSmartCardError: "Platform already initialized".

    // Create transport for jsapdu-over-ip (use active AuthManager URL to avoid stale persisted config)
    this.transport = new RouterServerTransport({
      routerUrl: this.authManager.getRouterUrl(),
      cardhostUuid: config.uuid,
    });

    // Create SmartCardPlatformAdapter (jsapdu-over-ip server side)
    // This handles all RPC protocol, serialization, and method dispatching
    this.adapter = new SmartCardPlatformAdapter(this.platform, this.transport);

    // Start transport (connects to Router)
    await this.adapter.start();

    this.connected = true;
  }

  /**
   * Disconnect from Router and cleanup
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    // Stop adapter and transport
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }

    this.transport = null;

    // Release platform
    if (this.platform.isInitialized()) {
      await this.platform.release();
    }

    this.connected = false;
  }

  /**
   * Get Cardhost UUID
   */
  getUuid(): string {
    return this.configManager.getUuid();
  }

  /**
   * Check if connected to Router
   */
  isConnected(): boolean {
    return this.connected && this.transport?.isConnected() === true;
  }

  /**
   * Get underlying platform (for testing/inspection)
   */
  getPlatform(): SmartCardPlatform {
    return this.platform;
  }

  /**
   * Async disposal support (await using)
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}
