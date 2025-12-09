/**
 * Router Transport for Cardhost
 * 
 * 責務分離:
 * 1. WsAuthenticator: 認証・セッション確立
 * 2. RouterServerTransport: RPC通信（仮想論理チャネル）
 * 
 * Implements ServerTransport interface from jsapdu-over-ip
 */

import { WebSocket } from "ws";
import type { ServerTransport } from "@aokiapp/jsapdu-over-ip";
import type {
  RpcRequest,
  RpcResponse,
  RpcEvent,
} from "@aokiapp/jsapdu-over-ip";
import { createLogger } from "@remote-apdu/shared";
import type { WsContext } from "@remote-apdu/shared";
import { WsServer, WsContextImpl, MessageRouter } from "@remote-apdu/shared";
import { verifyDerivedUuid, signChallenge } from "./auth-utils.js";

const logger = createLogger("cardhost:transport");

// ========== WsAuthenticator: 認証・セッション確立 ==========

export interface WsAuthenticatorConfig {
  routerUrl: string;
  publicKey: string;
  privateKey: string;
  onControllerConnected?: () => void | Promise<void>;
}

/**
 * WebSocket接続と認証フローを専門に管理
 * 認証後、Router派生のUUIDを取得
 */
export class WsAuthenticator {
  private ws: WebSocket | null = null;
  private uuid: string | null = null;
  private challenge: string | null = null;
  private authenticated = false;

  constructor(private config: WsAuthenticatorConfig) {}

  /**
   * WebSocket接続と認証フロー実行
   */
  async authenticate(): Promise<string> {
    if (this.authenticated) {
      return this.uuid!;
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.config.routerUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:")
        .replace(/\/$/, "");

      this.ws = new WebSocket(`${wsUrl}/ws/cardhost`);

      const ctx = new WsContextImpl<any>(this.ws, {});
      const authRouter = new MessageRouter()
        .register("auth-challenge", (c, msg: any) => this.handleAuthChallenge(c, msg))
        .register("auth-success", (c, msg: any) => this.handleAuthSuccess(c, msg))
        .register("error", (c, msg: any) => this.handleAuthError(c, msg, reject));

      this.ws.on("open", async () => {
        try {
          // auth-init 送信
          await ctx.send({
            type: "auth-init",
            publicKey: this.config.publicKey,
          });
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (!this.authenticated) {
            await authRouter.route(ctx, msg);
          }
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on("error", (err) => {
        reject(err);
      });

      this.ws.on("close", () => {
        if (!this.authenticated) {
          reject(new Error("WebSocket closed before authentication"));
        }
      });

      // 認証完了待機
      const checkInterval = setInterval(() => {
        if (this.authenticated) {
          clearInterval(checkInterval);
          resolve(this.uuid!);
        }
      }, 100);

      // タイムアウト
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!this.authenticated) {
          reject(new Error("Authentication timeout"));
        }
      }, 10000);
    });
  }

  /**
   * auth-challenge ハンドラー
   */
  private async handleAuthChallenge(ctx: WsContext, msg: any): Promise<void> {
    const { uuid, challenge } = msg;

    // UUID検証
    await verifyDerivedUuid(uuid, this.config.publicKey);
    this.uuid = uuid;
    this.challenge = challenge;

    // 署名
    const signature = await signChallenge(challenge, this.config.privateKey);

    // auth-verify 送信
    await ctx.send({
      type: "auth-verify",
      signature,
    });
  }

  /**
   * auth-success ハンドラー
   */
  private async handleAuthSuccess(ctx: WsContext, msg: any): Promise<void> {
    this.authenticated = true;
    logger.info("Authentication successful", { uuid: this.uuid });

    // 認証後、controller-connected メッセージを待機
    if (this.config.onControllerConnected) {
      this.setupControllerConnectedListener(ctx);
    }
  }

  /**
   * Controller接続通知リスナー設定
   */
  private setupControllerConnectedListener(ctx: WsContext): void {
    const onMessage = async (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "controller-connected") {
          logger.info("Controller connected notification received");
          // コールバック実行（遅延初期化）
          if (this.config.onControllerConnected) {
            await this.config.onControllerConnected();
          }
        }
      } catch (err) {
        // Ignore parse errors
      }
    };

    this.ws!.on("message", onMessage);
  }

  /**
   * エラーハンドラー
   */
  private async handleAuthError(
    ctx: WsContext,
    msg: any,
    reject: (err: Error) => void
  ): Promise<void> {
    reject(new Error(`Auth error: ${msg.error.code} - ${msg.error.message}`));
  }

  /**
   * 認証済みWebSocketを取得（RouterServerTransportで使用）
   */
  getWebSocket(): WebSocket {
    if (!this.ws || !this.authenticated) {
      throw new Error("Not authenticated");
    }
    return this.ws;
  }

  /**
   * UUID取得
   */
  getUuid(): string {
    if (!this.uuid) {
      throw new Error("Not authenticated");
    }
    return this.uuid;
  }

  /**
   * 認証状態確認
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * クローズ
   */
  async close(): Promise<void> {
    if (this.ws) {
      return new Promise((resolve) => {
        this.ws!.once("close", resolve);
        this.ws!.close();
      });
    }
  }
}

// ========== RouterServerTransport: RPC通信 ==========

export interface RouterTransportConfig {
  authenticator: WsAuthenticator;
}

/**
 * WebSocket上の仮想論理チャネル
 * 認証後のRPC通信を担当（jsapdu-over-ip ServerTransport interface実装）
 * 
 * 注: 認証はWsAuthenticatorが行済みであることを前提
 */
export class RouterServerTransport implements ServerTransport {
  private ws: WebSocket | null = null;
  private requestHandler?: (request: RpcRequest) => Promise<RpcResponse>;
  private connected = false;

  constructor(private config: RouterTransportConfig) {}

  /**
   * Register RPC request handler
   */
  onRequest(handler: (request: RpcRequest) => Promise<RpcResponse>): void {
    this.requestHandler = handler;
  }

  /**
   * Send event to Router (which relays to Controller)
   */
  emitEvent(event: RpcEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const envelope = {
      type: "rpc-event",
      payload: event,
    };

    this.ws.send(JSON.stringify(envelope));
  }

  /**
   * Start transport
   * 認証済みのWebSocketを使用してRPC通信を開始
   */
  async start(): Promise<void> {
    if (this.connected) {
      throw new Error("Transport already started");
    }

    // 認証済みWebSocketを取得
    this.ws = this.config.authenticator.getWebSocket();

    // RPC メッセージハンドリング設定
    this.ws.on("message", async (data) => {
      await this.handleMessage(data);
    });

    this.connected = true;
    logger.info("Transport started");
  }

  /**
   * Stop transport
   */
  async stop(): Promise<void> {
    if (!this.connected || !this.ws) {
      return;
    }

    // WebSocket自体は WsAuthenticator が管理するため、ここでは close しない
    this.connected = false;
    logger.info("Transport stopped");
  }

  /**
   * Handle incoming RPC message
   */
  private async handleMessage(data: unknown): Promise<void> {
    try {
      const message = JSON.parse(
        data instanceof Buffer ? data.toString("utf8") : String(data),
      );

      // Handle RPC request
      if (message.type === "rpc-request" && this.requestHandler) {
        const request = message.payload as RpcRequest;
        const response = await this.requestHandler(request);

        // Send response back
        const responseEnvelope = {
          type: "rpc-response",
          payload: response,
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(responseEnvelope));
        }
      }
    } catch (error) {
      // Suppress console output in library code
      logger.error("Error handling message", error as Error);
    }
  }

  /**
   * Check if transport is connected
   */
  isConnected(): boolean {
    return (
      this.connected &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }
}
