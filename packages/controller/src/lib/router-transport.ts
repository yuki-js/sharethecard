/**
 * Router Transport for Controller
 * 
 * 責務分離:
 * 1. WsAuthenticator: 認証・セッション確立
 * 2. RouterClientTransport: RPC通信（仮想論理チャネル）
 * 
 * Implements ClientTransport interface from jsapdu-over-ip
 */

import { WebSocket } from "ws";
import type { ClientTransport } from "@aokiapp/jsapdu-over-ip";
import type {
  RpcRequest,
  RpcResponse,
  RpcEvent,
} from "@aokiapp/jsapdu-over-ip";
import { createLogger, WsContextImpl, MessageRouter, signChallenge } from "@remote-apdu/shared";
import type { WsContext } from "@remote-apdu/shared";
import { verifyDerivedPeerId as verifyDerivedControllerId } from "@remote-apdu/shared";

const logger = createLogger("controller:transport");

// ========== WsAuthenticator: 認証・セッション確立 ==========

export interface WsAuthenticatorConfig {
  routerUrl: string;
  publicKey: string;
  privateKey: string;
}

/**
 * WebSocket接続と認証フロー（Controller側）を専門に管理
 * 認証後、Router派生のController IDを取得
 * さらに connect-cardhost フロー実行
 */
export class WsAuthenticator {
  private ws: WebSocket | null = null;
  private controllerId: string | null = null;
  private challenge: string | null = null;
  private authenticated = false;
  private connected = false;

  constructor(private config: WsAuthenticatorConfig) {}

  /**
   * WebSocket接続と認証・接続フロー実行
   */
  async authenticate(cardhostUuid: string): Promise<string> {
    if (this.authenticated && this.connected) {
      return this.controllerId!;
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this.config.routerUrl
        .replace(/^http:/, "ws:")
        .replace(/^https:/, "wss:")
        .replace(/\/$/, "");

      this.ws = new WebSocket(`${wsUrl}/ws/controller`);

      const ctx = new WsContextImpl<any>(this.ws, {});
      const authRouter = new MessageRouter()
        .register("auth-challenge", (c, msg: any) => this.handleAuthChallenge(c, msg))
        .register("auth-success", (c, msg: any) => this.handleAuthSuccess(c, msg))
        .register("connected", (c, msg: any) => this.handleConnected(c, msg))
        .register("error", (c, msg: any) => this.handleError(c, msg, reject));

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
          if (!this.authenticated || !this.connected) {
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
        if (!this.connected) {
          reject(new Error("WebSocket closed before connection established"));
        }
      });

      // 接続完了待機
      const checkInterval = setInterval(() => {
        if (this.authenticated && this.connected) {
          clearInterval(checkInterval);
          clearTimeout(timeoutHandle);
          resolve(this.controllerId!);
        }
      }, 100);

      // タイムアウト（10秒）
      const timeoutHandle = setTimeout(() => {
        clearInterval(checkInterval);
        if (!this.connected) {
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      // cardhostUuidの待機用変数
      ctx.state.targetCardhostUuid = cardhostUuid;
    });
  }

  /**
   * auth-challenge ハンドラー
   */
  private async handleAuthChallenge(ctx: WsContext, msg: any): Promise<void> {
    const { controllerId, challenge } = msg;

    // ID検証
    await verifyDerivedControllerId(controllerId, this.config.publicKey);
    this.controllerId = controllerId;
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
    logger.info("Authentication successful", { controllerId: this.controllerId });

    // 次: connect-cardhost 送信
    const cardhostUuid = ctx.state.targetCardhostUuid as string;
    await ctx.send({
      type: "connect-cardhost",
      cardhostUuid,
    });
  }

  /**
   * connected ハンドラー
   */
  private async handleConnected(ctx: WsContext, msg: any): Promise<void> {
    this.connected = true;
    logger.info("Connected to cardhost", { cardhostUuid: msg.cardhostUuid });
  }

  /**
   * エラーハンドラー
   */
  private async handleError(
    ctx: WsContext,
    msg: any,
    reject: (err: Error) => void
  ): Promise<void> {
    reject(new Error(`Error: ${msg.error.code} - ${msg.error.message}`));
  }

  /**
   * 認証済みWebSocketを取得（RouterClientTransportで使用）
   */
  getWebSocket(): WebSocket {
    if (!this.ws || !this.connected) {
      throw new Error("Not authenticated/connected");
    }
    return this.ws;
  }

  /**
   * Controller ID取得
   */
  getControllerId(): string {
    if (!this.controllerId) {
      throw new Error("Not authenticated");
    }
    return this.controllerId;
  }

  /**
   * 接続状態確認
   */
  isConnected(): boolean {
    return this.connected;
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

// ========== RouterClientTransport: RPC通信 ==========

export interface RouterClientTransportConfig {
  authenticator: WsAuthenticator;
}

/**
 * WebSocket上の仮想論理チャネル
 * 認証・接続後のRPC通信を担当（jsapdu-over-ip ClientTransport interface実装）
 * 
 * 注: 認証はWsAuthenticatorが行済みであることを前提
 */
export class RouterClientTransport implements ClientTransport {
  private ws: WebSocket | null = null;
  private eventCallbacks: Set<(event: RpcEvent) => void> = new Set();
  private pendingCalls = new Map<string, (response: RpcResponse) => void>();
  private connected = false;
  private callIdCounter = 0;

  constructor(private config: RouterClientTransportConfig) {}

  /**
   * Call RPC method via WebSocket
   */
  async call(request: RpcRequest): Promise<RpcResponse> {
    if (!this.connected) {
      throw new Error("Transport not connected");
    }

    const id = `rpc_${Date.now()}_${this.callIdCounter++}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`RPC timeout: ${id}`));
      }, 5000);

      // レスポンス待機設定
      this.pendingCalls.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      // リクエスト送信
      try {
        this.ws!.send(
          JSON.stringify({
            type: "rpc-request",
            id,
            payload: request,
          })
        );
      } catch (err) {
        clearTimeout(timeout);
        this.pendingCalls.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Register event listener
   */
  onEvent(callback: (event: RpcEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
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
   * Close transport
   */
  async close(): Promise<void> {
    this.eventCallbacks.clear();
    this.pendingCalls.clear();
    this.connected = false;
  }

  /**
   * Handle incoming RPC message
   */
  private async handleMessage(data: unknown): Promise<void> {
    try {
      const message = JSON.parse(
        data instanceof Buffer ? data.toString("utf8") : String(data),
      );

      // Handle RPC response
      if (message.type === "rpc-response") {
        const { id, payload } = message;
        const resolve = this.pendingCalls.get(id);
        if (resolve) {
          this.pendingCalls.delete(id);
          resolve(payload as RpcResponse);
        }
      }

      // Handle RPC event
      if (message.type === "rpc-event") {
        const { payload } = message;
        this.eventCallbacks.forEach((cb) => cb(payload as RpcEvent));
      }
    } catch (error) {
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
