/**
 * Controller Client - Core Library
 * Wraps RemoteSmartCardPlatform from jsapdu-over-ip
 * Provides testable, composable Controller functionality
 *
 * Spec: docs/what-to-make.md Section 3.1 - Controller
 * Reference: research/jsapdu-over-ip/src/client/platform-proxy.ts
 */

import { RemoteSmartCardPlatform } from "@aokiapp/jsapdu-over-ip/client";
import {
  CommandApdu,
  ResponseApdu,
  SmartCardError,
} from "@aokiapp/jsapdu-interface";
import { WsAuthenticator, RouterClientTransport } from "./router-transport.js";
import { KeyManager } from "./key-manager.js";

/**
 * Controller Configuration
 */
export interface ControllerConfig {
  routerUrl: string;
  cardhostUuid?: string;
  verbose?: boolean;
  keyManager?: KeyManager; // Optional for testing
}

/**
 * Controller Client
 *
 * This is the library core - fully testable without CLI.
 *
 * Usage:
 * ```typescript
 * const client = new ControllerClient({
 *   routerUrl: 'https://router.example.com',
 *   cardhostUuid: 'peer_...'
 * });
 *
 * await client.connect();
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
 * await client.connect();
 * const response = await client.transmit(command);
 * // Auto-cleanup on scope exit
 * ```
 */
export class ControllerClient {
  private platform: RemoteSmartCardPlatform | null = null;
  private transport: RouterClientTransport | null = null;
  private authenticator: WsAuthenticator | null = null;
  private keyManager: KeyManager;
  private connectedCardhostUuid: string | null = null;

  constructor(private config: ControllerConfig) {
    this.keyManager = config.keyManager ?? new KeyManager();
  }

  /**
   * Connect to Router and establish connection with specific Cardhost
   *
   * Steps:
   * 1. Load or generate keypair
   * 2. WebSocket認証 + Cardhost接続
   * 3. RemoteSmartCardPlatform初期化
   */
  async connect(cardhostUuid?: string): Promise<void> {
    const uuid = cardhostUuid ?? this.config.cardhostUuid;
    if (!uuid) {
      throw new SmartCardError(
        "INVALID_PARAMETER",
        "Cardhost UUID required. Provide via config or parameter.",
      );
    }

    if (this.platform) {
      throw new SmartCardError(
        "ALREADY_CONNECTED",
        "Already connected. Disconnect first.",
      );
    }

    // Load or generate keypair
    await this.keyManager.loadOrGenerate();
    const publicKey = this.keyManager.getPublicKey();
    const privateKey = this.keyManager.getPrivateKey();

    // Step 1: WebSocket認証 + Cardhost接続
    this.authenticator = new WsAuthenticator({
      routerUrl: this.config.routerUrl,
      publicKey,
      privateKey,
    });

    await this.authenticator.authenticate(uuid);

    // Step 2: RPC通信用トランスポート作成
    this.transport = new RouterClientTransport({
      authenticator: this.authenticator,
    });

    // Step 3: トランスポート開始
    await this.transport.start();

    // Step 4: RemoteSmartCardPlatform作成
    this.platform = new RemoteSmartCardPlatform(this.transport);
    await this.platform.init(true);

    this.connectedCardhostUuid = uuid;
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
        "NOT_CONNECTED",
        "Not connected. Call connect() first.",
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
    const devices = await platform.getDeviceInfo();
    if (devices.length === 0) {
      throw new SmartCardError(
        "NO_READERS",
        "No devices available on Cardhost",
      );
    }

    const device = await platform.acquireDevice(devices[0].id);
    try {
      // Wait for card if not present
      const isPresent = await device.isCardPresent();
      if (!isPresent) {
        throw new SmartCardError(
          "CARD_NOT_PRESENT",
          "Card not present. Insert card and try again.",
        );
      }

      const card = await device.startSession();
      try {
        return await card.transmit(command);
      } finally {
        try {
          await card.release();
        } catch (err) {
          console.warn("[ControllerClient] Card cleanup error:", err);
        }
      }
    } finally {
      try {
        await device.release();
      } catch (err) {
        console.warn("[ControllerClient] Device cleanup error:", err);
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
      await this.transport.close();
      this.transport = null;
    }

    if (this.authenticator) {
      await this.authenticator.close();
      this.authenticator = null;
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
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}
