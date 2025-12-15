/**
 * Cardhost Service - Core Library
 * Wraps SmartCardPlatform with jsapdu-over-ip ServerTransport
 * Provides testable, composable Cardhost functionality
 *
 * アーキテクチャ設計:
 * 1. 認証層：WsAuthenticator（認証のみ）
 * 2. 論理チャネル層：RouterServerTransport（E2E暗号化含む将来拡張可能）
 * 3. アプリケーション層：SmartCardPlatformAdapter（RPC処理）
 *
 * 遅延初期化：Controller接続時に初めて transport/adapter を作成
 */

import type { SmartCardPlatform } from "@aokiapp/jsapdu-interface";
import { SmartCardError } from "@aokiapp/jsapdu-interface";
import { SmartCardPlatformAdapter } from "@aokiapp/jsapdu-over-ip/server";
import { createLogger } from "@remote-apdu/shared";

import type { ConfigManager } from "./config-manager.js";
import { WsAuthenticator, RouterServerTransport } from "./router-transport.js";

const logger = createLogger("cardhost:service");

export interface CardhostServiceConfig {
  routerUrl: string;
  platform: SmartCardPlatform;
  configManager: ConfigManager;
}

/**
 * Cardhost Service
 *
 * 遅延初期化戦略:
 * - connect(): 認証のみ実行、WebSocket待機状態
 * - Controller接続時: その時点で transport/adapter を初期化
 *
 * これにより:
 * - リソース効率向上（使われるまで初期化しない）
 * - 明確な責務分離
 * - E2E暗号化への拡張性確保
 */
export class CardhostService {
  private platform: SmartCardPlatform;
  private adapter: SmartCardPlatformAdapter | null = null;
  private transport: RouterServerTransport | null = null;
  private authenticator: WsAuthenticator | null = null;
  private configManager: ConfigManager;
  private authenticated = false;

  constructor(config: CardhostServiceConfig) {
    this.platform = config.platform;
    this.configManager = config.configManager;
  }

  /**
   * Connect to Router and authenticate
   *
   * Phase 1: 認証のみ
   * - WebSocket接続
   * - チャレンジ-レスポンス認証
   * - Controller接続待機状態
   *
   * Phase 2: Controller接続時（遅延初期化）
   * - transport/adapter作成
   * - RPC待機開始
   */
  async connect(routerUrl?: string): Promise<void> {
    if (this.authenticated) {
      throw new SmartCardError("ALREADY_CONNECTED", "Already connected");
    }

    const url = routerUrl || (await this.getConfiguredRouterUrl());

    // Load/create config (keypair)
    const config = await this.configManager.loadOrCreate(url);

    // Phase 1: 認証のみ
    this.authenticator = new WsAuthenticator({
      routerUrl: url,
      publicKey: config.signingPublicKey,
      privateKey: config.signingPrivateKey,
      onControllerConnected: () => this.initializeTransport(),
    });

    await this.authenticator.authenticate();

    this.authenticated = true;
    logger.info("Cardhost authenticated, waiting for Controller connection");
  }

  /**
   * Initialize transport and adapter (called when Controller connects)
   * 遅延初期化：Controller接続時に呼ばれる
   */
  private async initializeTransport(): Promise<void> {
    // Check if we need to reinitialize
    const needsReinit =
      !this.transport || !this.adapter || !this.transport.isConnected();

    if (!needsReinit) {
      logger.info("Transport/adapter already active, skipping");
      return;
    }

    // Cleanup existing resources if disconnected
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }
    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }

    logger.info("Controller connected, initializing transport/adapter");

    if (!this.authenticator) {
      throw new Error("Authenticator not initialized");
    }

    // 論理チャネル層：RPC通信用（E2E暗号化もここに将来追加）
    this.transport = new RouterServerTransport({
      authenticator: this.authenticator,
    });

    // アプリケーション層：jsapdu-over-ip RPC処理
    this.adapter = new SmartCardPlatformAdapter(this.platform, this.transport);

    // Start adapter (which internally starts transport)
    // Note: SmartCardPlatformAdapter.start() calls transport.start() internally
    await this.adapter.start();

    logger.info("Transport/adapter initialized, ready for RPC");
  }

  /**
   * Disconnect from Router and cleanup
   */
  async disconnect(): Promise<void> {
    if (!this.authenticated) {
      return;
    }

    // Stop adapter and transport
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }

    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }

    // Close WebSocket connection
    if (this.authenticator) {
      await this.authenticator.close();
      this.authenticator = null;
    }

    // Release platform
    if (this.platform.isInitialized()) {
      await this.platform.release();
    }

    this.authenticated = false;
  }

  /**
   * Check if connected to Router
   */
  isConnected(): boolean {
    return this.authenticated && (this.transport?.isConnected() ?? false);
  }

  /**
   * Get underlying platform (for testing/inspection)
   */
  getPlatform(): SmartCardPlatform {
    return this.platform;
  }

  /**
   * Get configured router URL
   */
  private async getConfiguredRouterUrl(): Promise<string> {
    const config = this.configManager.getConfig();
    if (!config.routerUrl) {
      throw new Error("Router URL not configured");
    }
    return config.routerUrl;
  }

  /**
   * Async disposal support (await using)
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}
