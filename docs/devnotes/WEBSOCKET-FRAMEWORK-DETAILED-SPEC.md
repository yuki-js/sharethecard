# WebSocketフレームワーク詳細仕様書

**Date**: 2025-12-09  
**Status**: 詳細設計フェーズ  
**Dependency Impact**: Hono削除戦略含む  

---

## 🎯 概要

本ドキュメントは、`packages/shared/src/ws-framework/` に構築される**WebSocketオンリーフレームワーク**の詳細仕様です。

Honoが HTTP APIの複雑性を解決したように、このフレームワークはWebSocketプロトコルの複雑性（メッセージルーティング、認証フェーズ分離、ライフサイクル管理）を解決します。

---

## 📦 ファイル構成

```
packages/shared/src/ws-framework/
├── types.ts                    # メッセージ型定義（プロトコル）
├── context.ts                  # WsContext実装
├── message-router.ts           # メッセージルーター
├── ws-server.ts                # WsServer実装（フレームワークコア）
├── middleware.ts               # ミドルウェアユーティリティ
└── utils.ts                    # ヘルパー関数

packages/shared/src/index.ts
└── ws-framework エクスポート追加

packages/shared/tests/ws-framework.test.ts
└── フレームワークテスト
```

---

## 1️⃣ `types.ts` - プロトコル型定義

```typescript
// packages/shared/src/ws-framework/types.ts

/**
 * すべてのWebSocketメッセージの基底型
 * 
 * 設計思想:
 * - type フィールドでメッセージを分類（auth-init, rpc-request等）
 * - id フィールドでrequest/response相関（オプション）
 * - ペイロードはメッセージ型に応じて異なる
 */
export interface BaseMessage {
  type: string;
  id?: string;
}

// ========== 認証メッセージ ==========

export interface AuthInitMessage extends BaseMessage {
  type: "auth-init";
  publicKey: string;  // Ed25519 public key (SPKI, base64)
}

export interface AuthChallengeMessage extends BaseMessage {
  type: "auth-challenge";
  uuid?: string;  // Cardhost: UUID; Controller: undefined
  controllerId?: string;  // Controller: ID; Cardhost: undefined
  challenge: string;  // Random nonce (base64)
}

export interface AuthVerifyMessage extends BaseMessage {
  type: "auth-verify";
  signature: string;  // Ed25519 signature (base64)
}

export interface AuthSuccessMessage extends BaseMessage {
  type: "auth-success";
  uuid?: string;  // Cardhost
  controllerId?: string;  // Controller
}

// ========== Controller接続メッセージ ==========

export interface ConnectCardhostMessage extends BaseMessage {
  type: "connect-cardhost";
  cardhostUuid: string;
}

export interface ConnectedMessage extends BaseMessage {
  type: "connected";
  cardhostUuid: string;
}

// ========== RPC メッセージ ==========

export interface RpcRequestMessage extends BaseMessage {
  type: "rpc-request";
  id: string;  // 必須（相関用）
  payload: unknown;
}

export interface RpcResponseMessage extends BaseMessage {
  type: "rpc-response";
  id: string;  // 必須（相関用）
  payload: unknown;
}

export interface RpcEventMessage extends BaseMessage {
  type: "rpc-event";
  payload: unknown;
}

// ========== エラーメッセージ ==========

export interface ErrorMessage extends BaseMessage {
  type: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ========== 制御メッセージ ==========

export interface PingMessage extends BaseMessage {
  type: "ping";
}

export interface PongMessage extends BaseMessage {
  type: "pong";
}

// ========== ユニオン型 ==========

export type Message =
  | AuthInitMessage
  | AuthChallengeMessage
  | AuthVerifyMessage
  | AuthSuccessMessage
  | ConnectCardhostMessage
  | ConnectedMessage
  | RpcRequestMessage
  | RpcResponseMessage
  | RpcEventMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/**
 * WsContext の状態型
 */
export interface WsContextState {
  authenticated?: boolean;
  uuid?: string;  // Cardhost
  controllerId?: string;  // Controller
  cardhostUuid?: string;  // Controller（接続中）
  phase?: "auth" | "connected" | "rpc";
  [key: string]: unknown;
}

/**
 * WsContext - メッセージ処理のための実行コンテキスト
 */
export interface WsContext<T extends WsContextState = WsContextState> {
  ws: WebSocket;
  state: T;

  // メッセージ送信
  send(message: Message): Promise<void>;
  sendError(code: string, message: string, id?: string): Promise<void>;

  // 応答待機
  waitForMessage(type: string, timeout?: number): Promise<Message>;
  waitForId(id: string, timeout?: number): Promise<Message>;

  // 接続管理
  close(code?: number, reason?: string): Promise<void>;

  // ヘルパー
  isOpen(): boolean;
}

/**
 * ハンドラー型定義
 */
export type WsHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>
) => Promise<void>;

export type MessageHandler<T extends WsContextState = WsContextState> = (
  ctx: WsContext<T>,
  msg: Message
) => Promise<void>;

/**
 * ミドルウェア型定義
 */
export type WsMiddleware<
  TIn extends WsContextState = WsContextState,
  TOut extends WsContextState = TIn
> = (
  ctx: WsContext<TIn>,
  next: () => Promise<void>
) => Promise<void>;
```

---

## 2️⃣ `context.ts` - WsContext実装

```typescript
// packages/shared/src/ws-framework/context.ts

import type { WebSocket } from "ws";
import type { WsContext, WsContextState, Message } from "./types.js";

/**
 * WsContext実装
 * 
 * 責務:
 * - WebSocket通信の抽象化
 * - 非同期メッセージ待機
 * - エラーハンドリング
 * - ライフサイクル管理
 */
export class WsContextImpl<T extends WsContextState = WsContextState>
  implements WsContext<T>
{
  private pendingMessages = new Map<
    string,
    (msg: Message) => void
  >();
  private pendingIds = new Map<string, (msg: Message) => void>();
  private messageListenerAttached = false;
  private closed = false;

  constructor(
    public ws: WebSocket,
    public state: T
  ) {
    this.attachMessageListener();
  }

  /**
   * メッセージリスナー設定（一度だけ）
   */
  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(
          data instanceof Buffer ? data.toString("utf8") : String(data)
        ) as Message;

        // id相関メッセージ処理
        if (msg.id) {
          const resolve = this.pendingIds.get(msg.id);
          if (resolve) {
            this.pendingIds.delete(msg.id);
            resolve(msg);
            return;
          }
        }

        // 型別メッセージ処理
        const typeResolve = this.pendingMessages.get(msg.type);
        if (typeResolve) {
          this.pendingMessages.delete(msg.type);
          typeResolve(msg);
        }
      } catch (err) {
        // JSON パース失敗等、サイレント無視
      }
    });

    this.messageListenerAttached = true;
  }

  /**
   * メッセージ送信
   */
  async send(message: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }

      this.ws.send(JSON.stringify(message), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * エラーメッセージ送信
   */
  async sendError(code: string, message: string, id?: string): Promise<void> {
    await this.send({
      type: "error",
      id,
      error: { code, message }
    } as any);
  }

  /**
   * メッセージタイプ別待機
   * 例: await ctx.waitForMessage("auth-challenge")
   */
  async waitForMessage(type: string, timeout = 5000): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMessages.delete(type);
        reject(new Error(`Timeout waiting for message type: ${type}`));
      }, timeout);

      this.pendingMessages.set(type, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /**
   * メッセージID別待機
   * 例: await ctx.waitForId("rpc_12345")
   */
  async waitForId(id: string, timeout = 5000): Promise<Message> {
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingIds.delete(id);
        reject(new Error(`Timeout waiting for message ID: ${id}`));
      }, timeout);

      this.pendingIds.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /**
   * 接続を閉じる
   */
  async close(code = 1000, reason = ""): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      this.ws.once("close", resolve);
      this.ws.close(code, reason);
    });
  }

  /**
   * 接続状態確認
   */
  isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }
}
```

---

## 3️⃣ `message-router.ts` - メッセージルーター

```typescript
// packages/shared/src/ws-framework/message-router.ts

import type { WsContext, WsContextState, Message, MessageHandler } from "./types.js";

/**
 * メッセージタイプごとのハンドラーをマッピングする
 * 
 * 使用例:
 * ```
 * const router = new MessageRouter()
 *   .register("auth-init", handleAuthInit)
 *   .register("auth-verify", handleAuthVerify)
 *   .register("error", handleError);
 *
 * ws.on("message", async (data) => {
 *   const msg = JSON.parse(data);
 *   await router.route(ctx, msg);
 * });
 * ```
 */
export class MessageRouter<T extends WsContextState = WsContextState> {
  private handlers = new Map<string, MessageHandler<T>>();
  private defaultHandler: MessageHandler<T> | null = null;

  /**
   * メッセージハンドラー登録
   */
  register(type: string, handler: MessageHandler<T>): this {
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * デフォルトハンドラー設定（未登録メッセージ用）
   */
  setDefault(handler: MessageHandler<T>): this {
    this.defaultHandler = handler;
    return this;
  }

  /**
   * メッセージをルートしてハンドラー実行
   */
  async route(ctx: WsContext<T>, msg: Message): Promise<void> {
    const handler = this.handlers.get(msg.type);

    if (handler) {
      await handler(ctx, msg);
    } else if (this.defaultHandler) {
      await this.defaultHandler(ctx, msg);
    } else {
      // ハンドラーなし → エラー応答
      await ctx.sendError(
        "UNKNOWN_MESSAGE_TYPE",
        `Unknown message type: ${msg.type}`,
        msg.id
      );
    }
  }

  /**
   * メッセージハンドラー存在確認
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * ハンドラー一覧取得
   */
  getRegistered(): string[] {
    return Array.from(this.handlers.keys());
  }
}
```

---

## 4️⃣ `ws-server.ts` - WsServer フレームワークコア

```typescript
// packages/shared/src/ws-framework/ws-server.ts

import type { WebSocket } from "ws";
import type {
  WsContext,
  WsContextState,
  WsHandler,
  WsMiddleware,
  Message
} from "./types.js";
import { WsContextImpl } from "./context.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("ws-framework");

/**
 * WebSocket フレームワーク
 * 
 * Honoのようなfluent APIで、認証フェーズとRPCフェーズを分離管理
 * 
 * 使用例:
 * ```typescript
 * const ws = new WsServer()
 *   .use(loggingMiddleware)
 *   .use(authenticationMiddleware)
 *   .onAuth(handleAuthPhase)
 *   .onRpc(handleRpcPhase);
 *
 * ws.on("connection", (socket) => {
 *   await ws.handle(socket);
 * });
 * ```
 */
export class WsServer<TGlobal extends WsContextState = WsContextState> {
  private middlewares: Array<WsMiddleware<any, any>> = [];
  private authHandler: WsHandler<TGlobal> | null = null;
  private rpcHandler: WsHandler<TGlobal & { authenticated: true }> | null = null;

  /**
   * グローバルミドルウェア追加
   * 認証・ログ・レート制限等を統一
   */
  use<TIn extends WsContextState, TOut extends WsContextState>(
    middleware: WsMiddleware<TIn, TOut>
  ): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 認証フェーズハンドラー設定
   */
  onAuth(handler: WsHandler<TGlobal>): this {
    this.authHandler = handler;
    return this;
  }

  /**
   * RPC フェーズハンドラー設定
   */
  onRpc(handler: WsHandler<TGlobal & { authenticated: true }>): this {
    this.rpcHandler = handler;
    return this;
  }

  /**
   * メインハンドラー - WebSocket接続時に呼び出し
   */
  async handle(ws: WebSocket): Promise<void> {
    const state: TGlobal = {} as TGlobal;
    const ctx = new WsContextImpl(ws, state);

    try {
      logger.debug("WebSocket connected");

      // ミドルウェアパイプライン実行
      await this.executeMiddlewarePipeline(ctx);

      // 認証フェーズ
      if (this.authHandler) {
        logger.debug("Entering auth phase");
        await this.authHandler(ctx);
      }

      // RPC フェーズ
      if (this.rpcHandler) {
        logger.debug("Entering RPC phase");
        await this.rpcHandler(ctx as any);
      }

      logger.debug("WebSocket session completed");
    } catch (error) {
      const err = error as Error;
      logger.error("WebSocket error", err);

      // エラー通知試行
      try {
        await ctx.sendError("INTERNAL_ERROR", err.message);
      } catch {}

      // 接続を閉じる
      try {
        await ctx.close(1011, "Internal error");
      } catch {}
    } finally {
      // クリーンアップ
      try {
        await ctx.close();
      } catch {}
    }
  }

  /**
   * ミドルウェアパイプライン実行
   */
  private async executeMiddlewarePipeline(ctx: WsContext): Promise<void> {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index >= this.middlewares.length) {
        return;
      }

      const middleware = this.middlewares[index++];
      await middleware(ctx, next);
    };

    await next();
  }
}

/**
 * ミドルウェアファクトリー
 */
export const WsMiddlewares = {
  /**
   * ロギングミドルウェア
   */
  logging(): WsMiddleware {
    return async (ctx, next) => {
      const start = Date.now();
      logger.info("WS connection started");

      try {
        await next();
      } finally {
        const duration = Date.now() - start;
        logger.info("WS connection closed", { duration });
      }
    };
  },

  /**
   * レート制限ミドルウェア（例）
   */
  rateLimit(maxMessages: number = 100, windowMs: number = 60000): WsMiddleware {
    return async (ctx, next) => {
      let messageCount = 0;
      const resetTimer = setInterval(() => {
        messageCount = 0;
      }, windowMs);

      ctx.ws.on("message", () => {
        messageCount++;
        if (messageCount > maxMessages) {
          ctx.close(1008, "Rate limit exceeded");
        }
      });

      try {
        await next();
      } finally {
        clearInterval(resetTimer);
      }
    };
  },

  /**
   * タイムアウトミドルウェア
   */
  timeout(ms: number = 30000): WsMiddleware {
    return async (ctx, next) => {
      const timer = setTimeout(() => {
        ctx.close(1000, "Session timeout");
      }, ms);

      ctx.ws.on("close", () => {
        clearTimeout(timer);
      });

      try {
        await next();
      } finally {
        clearTimeout(timer);
      }
    };
  },

  /**
   * ハートビートミドルウェア
   */
  heartbeat(interval: number = 30000): WsMiddleware {
    return async (ctx, next) => {
      const timer = setInterval(() => {
        if (ctx.isOpen()) {
          ctx.send({ type: "ping" } as any).catch(() => {
            clearInterval(timer);
          });
        }
      }, interval);

      try {
        await next();
      } finally {
        clearInterval(timer);
      }
    };
  }
};
```

---

## 🏗️ 統合フレームワーク使用例

### Cardhost側の使用

```typescript
// packages/cardhost/src/lib/router-transport.ts

import { WsServer, MessageRouter } from "@remote-apdu/shared";
import type { WsContext } from "@remote-apdu/shared";

export class RouterServerTransport {
  private wsFramework: WsServer | null = null;

  private setupFramework(): WsServer {
    const ws = new WsServer();

    // 認証フェーズ
    ws.onAuth(async (ctx) => {
      // auth-init 送信
      await ctx.send({
        type: "auth-init",
        publicKey: this.publicKey
      });

      // 認証メッセージハンドリング
      const authRouter = new MessageRouter()
        .register("auth-challenge", async (ctx, msg) => {
          // チャレンジ処理
          const signature = await this.signChallenge(msg.challenge);
          await ctx.send({
            type: "auth-verify",
            signature
          });
        })
        .register("auth-success", async (ctx) => {
          ctx.state.authenticated = true;
          this.uuid = ctx.state.uuid;
        });

      // メッセージハンドリングループ
      let listening = true;
      const onMessage = async (data: any) => {
        const msg = JSON.parse(data.toString());
        if (!ctx.state.authenticated) {
          await authRouter.route(ctx, msg);
        } else {
          listening = false;
        }
      };

      ctx.ws.on("message", onMessage);

      // 認証完了待機
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (ctx.state.authenticated) {
            clearInterval(checkInterval);
            ctx.ws.off("message", onMessage);
            listening = false;
            resolve();
          }
        }, 100);
      });
    });

    // RPC フェーズ
    ws.onRpc(async (ctx) => {
      ctx.ws.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "rpc-request") {
          // RPC処理
        }
      });
    });

    return ws;
  }
}
```

---

## 🚀 Hono削除戦略

### 現状
```typescript
// packages/router/src/server.ts (現在)
import { Hono } from "hono";

const app = new Hono();
app.get("/health", ...);
app.get("/stats", ...);
app.route("/", controllerRoutes);  // REST API
app.route("/", cardhostRoutes);    // REST API
```

### 改修後
```typescript
// packages/router/src/server.ts (改修後)
// Honoなし - HTTPサーバーのみシンプル実装

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const httpServer = createServer((req, res) => {
  // /health
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, running: router.isRunning() }));
    return;
  }

  // /stats
  if (req.url === "/stats" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(router.getStats()));
    return;
  }

  // その他 404
  res.writeHead(404);
  res.end();
});

// WebSocket統合
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  if (req.url?.startsWith("/ws/controller")) {
    wsControllerHandler.handle(ws);
  } else if (req.url?.startsWith("/ws/cardhost")) {
    wsCardhostHandler.handle(ws);
  } else {
    ws.close(1008, "Invalid path");
  }
});

httpServer.listen(port, host);
```

### 削除ファイル
```
packages/router/src/presentation/rest/
├── controller-routes.ts  ❌ DELETE
└── cardhost-routes.ts    ❌ DELETE

packages/router/package.json
└── dependencies: hono, @hono/node-server 削除
```

### 追加ファイル
```
packages/router/src/presentation/http/
├── health.ts             ✨ シンプルな /health ハンドラー
└── stats.ts              ✨ シンプルな /stats ハンドラー
```

---

## ✅ チェックリスト

### フレームワーク実装
- [ ] `types.ts` - メッセージ型定義
- [ ] `context.ts` - WsContext実装
- [ ] `message-router.ts` - ルーター実装
- [ ] `ws-server.ts` - コア実装
- [ ] テスト

### Hono削除
- [ ] `presentation/rest/*` 削除
- [ ] `server.ts` 書き直し
- [ ] `package.json` 依存削除

### 統合
- [ ] Cardhost: フレームワーク活用
- [ ] Controller: フレームワーク活用
- [ ] Router: フレームワーク活用

---

**次ステップ**: 詳細実装ガイドを作成
