# 統合WebSocketアーキテクチャ設計書

**Date**: 2025-12-09  
**Status**: 設計フェーズ  
**Scope**: 全3モジュール（Cardhost, Controller, Router）統合設計  

---

## 📐 設計原則

### 1. Zero HTTP Principle（HTTP完全廃止）
- すべての通信をWebSocketで統一
- 認証、RPC、イベント通知がすべてWebSocket内で完結
- REST API削除（`/health`, `/stats`のみ保持）

### 2. WebSocket Framework Pattern（Hono-like）
- 低レベルのWebSocket処理を抽象化
- メッセージ型定義による型安全性
- ミドルウェアパイプライン（認証→ルーティング→ハンドラー）
- エラーハンドリングの統一

### 3. Message-Oriented Protocol
- すべての通信を型付きJSONメッセージに統一
- request/response相関用ID（`id`フィールド）
- メッセージルーティング（認証フェーズ vs. RPC フェーズ）

### 4. Stateful Connection Identity
- WebSocket接続自体がアイデンティティ
- UUID/ID送信不要（Router側で判定）
- 接続 = 自動識別

---

## 🏗️ WebSocketフレームワーク設計

### 1. メッセージプロトコル定義

```typescript
// packages/shared/src/ws-protocol/types.ts

/** すべてのメッセージの基底型 */
interface BaseMessage {
  type: string;
  id?: string;  // request/response相関用
}

/** 成功レスポンス */
interface SuccessMessage extends BaseMessage {
  type: "success";
  data?: unknown;
}

/** エラーレスポンス */
interface ErrorMessage extends BaseMessage {
  type: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** メッセージ識別子 */
type MessageType = 
  | "auth-init" | "auth-challenge" | "auth-verify" | "auth-success"
  | "connect-cardhost" | "connected"
  | "rpc-request" | "rpc-response" | "rpc-event"
  | "error" | "ping" | "pong";
```

### 2. ハンドシェイクフロー（状態遷移）

```
Connection State Machine:

CLOSED
  ↓ [WebSocket Connected]
CONNECTING
  ↓ [auth-init sent]
AUTHENTICATING
  ↓ [auth-verify sent]
AUTHENTICATED ← [Cardhost] or
AUTHENTICATED → [Controller, next step]
  ↓ [Controller only: connect-cardhost sent]
CONNECTED ← [Session established]
  ↓
RPC_READY
  ↓ [Close]
CLOSED
```

### 3. WebSocketフレームワーク実装

```typescript
// packages/shared/src/ws-framework/ws-server.ts

/**
 * 型安全なWebSocketサーバーフレームワーク
 * Honoのようなミドルウェアパイプラインで認証・ルーティング・ハンドリングを統一
 */
export interface WsContext<T extends Record<string, unknown> = {}> {
  ws: WebSocket;
  state: T;
  send(message: BaseMessage): Promise<void>;
  sendError(code: string, message: string, id?: string): Promise<void>;
  waitForMessage(type: string, timeout?: number): Promise<BaseMessage>;
  close(code?: number, reason?: string): Promise<void>;
}

export type WsHandler<T extends Record<string, unknown> = {}> = (
  ctx: WsContext<T>
) => Promise<void>;

export type WsMiddleware<
  TIn extends Record<string, unknown> = {},
  TOut extends Record<string, unknown> = TIn
> = (
  ctx: WsContext<TIn>,
  next: () => Promise<void>
) => Promise<void> | Promise<WsContext<TOut>>;

export interface WsRoute<T extends Record<string, unknown> = {}> {
  message: string;
  handler: (ctx: WsContext<T>, msg: BaseMessage) => Promise<void>;
}

/**
 * Honoのようなfluent API
 */
export class WsServer<TGlobal extends Record<string, unknown> = {}> {
  private middlewares: Array<WsMiddleware<any, any>> = [];
  private routes: Map<string, WsRoute> = new Map();
  private phaseHandlers: Map<string, WsHandler> = new Map();

  /**
   * ミドルウェア追加（認証、ロギング等）
   */
  use<TIn extends Record<string, unknown>, TOut extends Record<string, unknown>>(
    middleware: WsMiddleware<TIn, TOut>
  ): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 認証フェーズハンドラー設定
   */
  onAuth(handler: WsHandler<TGlobal>): this {
    this.phaseHandlers.set("auth", handler);
    return this;
  }

  /**
   * RPC フェーズハンドラー設定
   */
  onRpc(handler: WsHandler<TGlobal & { authenticated: true }>): this {
    this.phaseHandlers.set("rpc", handler);
    return this;
  }

  /**
   * メッセージハンドラーマッピング
   */
  on<T extends Record<string, unknown>>(
    messageType: string,
    handler: (ctx: WsContext<TGlobal & T>, msg: BaseMessage) => Promise<void>
  ): this {
    this.routes.set(messageType, { message: messageType, handler });
    return this;
  }

  /**
   * WebSocket接続処理（メインエントリーポイント）
   */
  async handle(ws: WebSocket): Promise<void> {
    const state: Record<string, unknown> = {};
    const ctx = new WsContextImpl(ws, state);

    try {
      // ミドルウェアパイプライン実行
      await this.executeMiddlewarePipeline(ctx);

      // 認証フェーズハンドラー
      const authHandler = this.phaseHandlers.get("auth");
      if (authHandler) {
        await authHandler(ctx);
      }

      // RPC フェーズハンドラー
      const rpcHandler = this.phaseHandlers.get("rpc");
      if (rpcHandler) {
        await rpcHandler(ctx);
      }
    } catch (error) {
      await ctx.sendError("INTERNAL_ERROR", (error as Error).message);
      ctx.close(1011, "Internal error");
    }
  }

  private async executeMiddlewarePipeline(ctx: WsContext): Promise<void> {
    let index = 0;
    const next = async () => {
      if (index >= this.middlewares.length) return;
      const middleware = this.middlewares[index++];
      await middleware(ctx, next);
    };
    await next();
  }
}

/**
 * WsContext実装
 */
class WsContextImpl<T extends Record<string, unknown> = {}> implements WsContext<T> {
  private pendingMessages = new Map<string, Promise<BaseMessage>>();

  constructor(
    public ws: WebSocket,
    public state: T
  ) {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pendingMessages.has(msg.id)) {
        const resolve = this.pendingMessages.get(msg.id);
        if (resolve) {
          this.pendingMessages.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  async send(message: BaseMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }
      this.ws.send(JSON.stringify(message), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async sendError(code: string, message: string, id?: string): Promise<void> {
    await this.send({
      type: "error",
      id,
      error: { code, message }
    });
  }

  async waitForMessage(type: string, timeout = 5000): Promise<BaseMessage> {
    const id = `wait_${Date.now()}_${Math.random()}`;
    
    return Promise.race([
      new Promise<BaseMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingMessages.delete(id);
          reject(new Error(`Timeout waiting for ${type}`));
        }, timeout);

        this.pendingMessages.set(id, Promise.resolve().then(async () => {
          clearTimeout(timer);
          const msg = await new Promise<BaseMessage>((res) => {
            this.pendingMessages.set(id, Promise.resolve(msg).then(res));
          });
          resolve(msg);
        }));
      })
    ]);
  }

  async close(code = 1000, reason = ""): Promise<void> {
    return new Promise((resolve) => {
      this.ws.once("close", resolve);
      this.ws.close(code, reason);
    });
  }
}
```

### 4. メッセージルーター

```typescript
// packages/shared/src/ws-framework/message-router.ts

/**
 * メッセージタイプごとのハンドラーをプール管理
 */
export class MessageRouter<T extends Record<string, unknown> = {}> {
  private handlers = new Map<
    string,
    (ctx: WsContext<T>, msg: BaseMessage) => Promise<void>
  >();

  register(
    type: string,
    handler: (ctx: WsContext<T>, msg: BaseMessage) => Promise<void>
  ): this {
    this.handlers.set(type, handler);
    return this;
  }

  async route(ctx: WsContext<T>, msg: BaseMessage): Promise<void> {
    const handler = this.handlers.get(msg.type);
    if (!handler) {
      await ctx.sendError("UNKNOWN_MESSAGE_TYPE", `Unknown message type: ${msg.type}`, msg.id);
      return;
    }
    await handler(ctx, msg);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}
```

---

## 🎯 モジュール別設計

### Phase A: Cardhost統合設計

#### A.1 認証フロー（WebSocketベース）

```
Cardhost                          Router
   │                               │
   │  [WebSocket /ws/cardhost]    │
   ├──────────────────────────────>│
   │                               │
   │  auth-init                    │
   │  {                            │
   │    type: "auth-init",         │
   │    publicKey: "..."           │
   │  }                            │
   ├──────────────────────────────>│
   │                               │
   │                    [Router: derive UUID]
   │                    [Router: generate challenge]
   │                               │
   │  auth-challenge               │
   │  {                            │
   │    type: "auth-challenge",    │
   │    uuid: "peer_...",          │
   │    challenge: "nonce..."      │
   │  }                            │
   │<──────────────────────────────┤
   │                               │
   │  [Verify UUID from publicKey] │
   │  [Sign challenge]             │
   │                               │
   │  auth-verify                  │
   │  {                            │
   │    type: "auth-verify",       │
   │    signature: "..."           │
   │  }                            │
   ├──────────────────────────────>│
   │                               │
   │            [Verify signature] │
   │            [Map: ws ↔ uuid]   │
   │                               │
   │  auth-success                 │
   │  {                            │
   │    type: "auth-success",      │
   │    uuid: "peer_..."           │
   │  }                            │
   │<──────────────────────────────┤
   │                               │
   │  [RPC ready]                  │
   │                               │
```

#### A.2 ファイル構成変更

```
packages/cardhost/src/lib/

現在:
├── auth-manager.ts        [HTTP REST認証]
├── router-transport.ts    [RPC のみ]
└── cardhost-service.ts

変更後:
├── auth-manager.ts        [削除または ✏️ 統合]
├── router-transport.ts    ✏️ [WebSocket認証 + RPC統合]
└── cardhost-service.ts    ✏️ [簡略化]

新規追加:
├── ws-authenticator.ts    [WebSocketメッセージ認証ハンドラー]
└── connection-handler.ts  [接続ライフサイクル管理]
```

#### A.3 実装フロー

```typescript
// packages/cardhost/src/lib/router-transport.ts (改修後)

export class RouterServerTransport implements ServerTransport {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private uuid: string | null = null;
  private config: RouterTransportConfig;
  private wsFramework: WsServer;

  constructor(config: RouterTransportConfig) {
    this.config = config;
    this.wsFramework = this.setupWsFramework();
  }

  private setupWsFramework(): WsServer {
    const ws = new WsServer();

    // 認証フェーズ
    ws.onAuth(async (ctx) => {
      const router = new MessageRouter()
        .register("auth-challenge", this.handleAuthChallenge.bind(this))
        .register("auth-success", this.handleAuthSuccess.bind(this))
        .register("error", this.handleAuthError.bind(this));

      // auth-init 送信
      await ctx.send({
        type: "auth-init",
        publicKey: this.config.publicKey
      });

      // メッセージハンドリングループ
      ctx.ws.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        if (!this.authenticated) {
          await router.route(ctx as any, msg);
        }
      });

      // 認証完了待機
      await new Promise<void>((resolve) => {
        this.onAuthenticated = resolve;
      });
    });

    // RPC フェーズ
    ws.onRpc(async (ctx) => {
      ctx.ws.on("message", async (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "rpc-request") {
          await this.handleRpcRequest(msg);
        }
      });
    });

    return ws;
  }

  async start(): Promise<void> {
    const wsUrl = this.config.routerUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsUrl}/ws/cardhost`);

      this.ws.on("open", async () => {
        try {
          await this.wsFramework.handle(this.ws!);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on("error", (err) => {
        if (!this.authenticated) reject(err);
      });
    });
  }

  private async handleAuthChallenge(ctx: WsContext, msg: any): Promise<void> {
    const { uuid, challenge } = msg;

    // UUID検証
    await verifyDerivedUuid(uuid, this.config.publicKey);
    this.uuid = uuid;

    // 署名
    const signature = await signChallenge(challenge, this.config.privateKey);

    // 検証要求送信
    await ctx.send({
      type: "auth-verify",
      signature
    });
  }

  private async handleAuthSuccess(ctx: WsContext, msg: any): Promise<void> {
    this.authenticated = true;
    if (this.onAuthenticated) {
      this.onAuthenticated();
    }
  }

  private onAuthenticated: (() => void) | null = null;

  // ... RPC ハンドリングメソッド
}
```

---

### Phase B: Controller統合設計

#### B.1 認証フロー（WebSocketベース）

```
Controller                        Router
   │                               │
   │  [WebSocket /ws/controller]  │
   ├──────────────────────────────>│
   │                               │
   │  auth-init                    │
   │  {                            │
   │    type: "auth-init",         │
   │    publicKey: "..."           │
   │  }                            │
   ├──────────────────────────────>│
   │                               │
   │                [Router: derive ID]
   │                [Router: generate challenge]
   │                               │
   │  auth-challenge               │
   │  {                            │
   │    type: "auth-challenge",    │
   │    controllerId: "peer_...",  │
   │    challenge: "nonce..."      │
   │  }                            │
   │<──────────────────────────────┤
   │                               │
   │  [Verify ID from publicKey]   │
   │  [Sign challenge]             │
   │                               │
   │  auth-verify                  │
   │  {                            │
   │    type: "auth-verify",       │
   │    signature: "..."           │
   │  }                            │
   ├──────────────────────────────>│
   │                               │
   │           [Verify signature]  │
   │           [Map: ws ↔ ctrlId]  │
   │                               │
   │  auth-success                 │
   │  {                            │
   │    type: "auth-success",      │
   │    controllerId: "peer_..."   │
   │  }                            │
   │<──────────────────────────────┤
   │                               │
   │  [Authenticated]              │
   │                               │
   │  connect-cardhost             │
   │  {                            │
   │    type: "connect-cardhost",  │
   │    cardhostUuid: "peer_..."   │
   │  }                            │
   ├──────────────────────────────>│
   │                               │
   │          [Create session]     │
   │          [Map: session ↔ ch]  │
   │                               │
   │  connected                    │
   │  {                            │
   │    type: "connected",         │
   │    cardhostUuid: "..."        │
   │  }                            │
   │<──────────────────────────────┤
   │                               │
   │  [RPC ready]                  │
   │                               │
```

#### B.2 ファイル構成変更

```
packages/controller/src/lib/

現在:
├── session-manager.ts     [HTTP REST認証]
├── router-transport.ts    [HTTP RPC]
└── controller-client.ts

変更後:
├── session-manager.ts     ✏️ [WebSocket統合]
├── router-transport.ts    ✏️ [WebSocket認証 + RPC]
└── controller-client.ts   ✏️ [簡略化]

新規追加:
├── ws-authenticator.ts    [WebSocketメッセージ認証ハンドラー]
└── connection-handler.ts  [接続ライフサイクル管理]
```

#### B.3 実装フロー

```typescript
// packages/controller/src/lib/router-transport.ts (改修後)

export class RouterClientTransport implements ClientTransport {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private connected = false;
  private controllerId: string | null = null;
  private pendingCalls = new Map<string, Promise<RpcResponse>>();
  private wsFramework: WsServer;

  async connect(cardhostUuid: string): Promise<void> {
    const wsUrl = this.config.routerUrl
      .replace(/^http:/, "ws:")
      .replace(/^https:/, "wss:");

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${wsUrl}/ws/controller`);

      this.ws.on("open", async () => {
        try {
          // 1. 認証フェーズ
          await this.authenticate();

          // 2. Cardhost接続フェーズ
          await this.connectToCardhost(cardhostUuid);

          // 3. RPC準備完了
          this.connected = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on("error", reject);
    });
  }

  private async authenticate(): Promise<void> {
    // auth-init 送信
    await this.send({
      type: "auth-init",
      publicKey: this.config.publicKey
    });

    // auth-challenge 待機
    const challenge = await this.waitForMessage("auth-challenge");

    // ID検証 + 署名
    const signature = await signChallenge(challenge.challenge, this.config.privateKey);

    // auth-verify 送信
    await this.send({
      type: "auth-verify",
      signature
    });

    // auth-success 待機
    const success = await this.waitForMessage("auth-success");
    this.controllerId = success.controllerId;
    this.authenticated = true;
  }

  private async connectToCardhost(cardhostUuid: string): Promise<void> {
    // connect-cardhost 送信
    await this.send({
      type: "connect-cardhost",
      cardhostUuid
    });

    // connected 待機
    await this.waitForMessage("connected");
  }

  async call(request: RpcRequest): Promise<RpcResponse> {
    if (!this.connected) {
      throw new Error("Not connected");
    }

    const id = `rpc_${Date.now()}_${Math.random()}`;
    const promise = this.waitForResponse(id);

    await this.send({
      type: "rpc-request",
      id,
      payload: request
    });

    return promise;
  }

  private async waitForResponse(id: string): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error("RPC timeout"));
      }, 5000);

      this.pendingCalls.set(id, Promise.resolve({} as RpcResponse).then((res) => {
        clearTimeout(timer);
        resolve(res);
      }));
    });
  }

  private async send(msg: any): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }
    return new Promise((resolve, reject) => {
      this.ws!.send(JSON.stringify(msg), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async waitForMessage(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const onMessage = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          this.ws!.off("message", onMessage);
          resolve(msg);
        }
      };

      const timeout = setTimeout(() => {
        this.ws!.off("message", onMessage);
        reject(new Error(`Timeout waiting for ${type}`));
      }, 5000);

      this.ws!.on("message", onMessage);
    });
  }

  // ... RPC ハンドリング
}
```

---

### Phase C: Router統合設計

#### C.1 WebSocket処理流れ

```
Router Main
  ├─ HTTP Server (/health, /stats のみ)
  ├─ WebSocket Server
  │   ├─ /ws/controller エンドポイント
  │   │   └─ WsServer (認証 → connect-cardhost → RPC)
  │   │
  │   └─ /ws/cardhost エンドポイント
  │       └─ WsServer (認証 → RPC)
  │
  └─ Business Logic Layer
      ├─ ControllerUseCase
      ├─ CardhostUseCase
      ├─ TransportUseCase
      └─ Services (Auth, Transport, Session)
```

#### C.2 ファイル構成変更

```
packages/router/src/

現在:
├── server.ts              [HTTP + WS ハイブリッド]
├── presentation/rest/
│   ├── controller-routes.ts
│   └── cardhost-routes.ts
└── presentation/ws/
    ├── controller-ws.ts
    └── cardhost-ws.ts

変更後:
├── server.ts              ✏️ [WebSocket統合 + REST削除]
├── presentation/rest/
│   └── [削除]
├── presentation/ws/
│   ├── controller-ws.ts   ✏️ [完全書き直し - フレームワーク活用]
│   └── cardhost-ws.ts     ✏️ [完全書き直し - フレームワーク活用]

新規追加:
├── presentation/ws/
│   ├── auth-handlers.ts   [認証メッセージハンドラー]
│   └── rpc-handlers.ts    [RPC メッセージハンドラー]
```

#### C.3 実装フロー（フレームワーク活用）

```typescript
// packages/router/src/presentation/ws/controller-ws.ts (改修後)

export function createControllerWsHandler(
  controllerUseCase: ControllerUseCase,
  transportUseCase: TransportUseCase
): WsHandler {
  const ws = new WsServer();

  // 認証フェーズ
  ws.onAuth(async (ctx) => {
    const authRouter = new MessageRouter()
      .register("auth-init", handleControllerAuthInit(controllerUseCase))
      .register("auth-verify", handleControllerAuthVerify(controllerUseCase));

    ctx.ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());
      
      // 認証完了まで認証メッセージのみ受け付け
      if (!ctx.state.authenticated) {
        await authRouter.route(ctx, msg);
      }
    });

    // 認証完了待機
    await new Promise<void>((resolve) => {
      ctx.state.onAuthenticated = resolve;
    });
  });

  // RPC フェーズ
  ws.onRpc(async (ctx) => {
    const rpcRouter = new MessageRouter()
      .register("connect-cardhost", handleConnectCardhost(controllerUseCase, transportUseCase))
      .register("rpc-request", handleRpcRequest(transportUseCase));

    ctx.ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());
      await rpcRouter.route(ctx, msg);
    });
  });

  return (ctx) => ws.handle(ctx.ws);
}

// ハンドラー実装例
function handleControllerAuthInit(controllerUseCase: ControllerUseCase) {
  return async (ctx: WsContext, msg: BaseMessage) => {
    const { publicKey } = msg as any;

    // Router派生ID + チャレンジ生成
    const { controllerId, challenge } = await controllerUseCase.initiateAuth(publicKey);

    // チャレンジ返送
    await ctx.send({
      type: "auth-challenge",
      controllerId,
      challenge
    });

    // 状態保存
    ctx.state.currentChallenge = challenge;
    ctx.state.publicKey = publicKey;
  };
}

function handleControllerAuthVerify(controllerUseCase: ControllerUseCase) {
  return async (ctx: WsContext, msg: BaseMessage) => {
    const { signature } = msg as any;
    const { currentChallenge, publicKey, controllerId } = ctx.state;

    // 署名検証
    const isValid = await controllerUseCase.verifyAuth(
      controllerId,
      currentChallenge,
      signature
    );

    if (!isValid) {
      await ctx.sendError("AUTH_FAILED", "Signature verification failed");
      await ctx.close(1008, "Authentication failed");
      return;
    }

    // 認証完了
    ctx.state.authenticated = true;
    ctx.state.controllerId = controllerId;

    // 成功通知
    await ctx.send({
      type: "auth-success",
      controllerId
    });

    // 次のフェーズへ遷移
    if (ctx.state.onAuthenticated) {
      ctx.state.onAuthenticated();
    }
  };
}
```

---

## 📊 全体アーキテクチャ図

```
┌─────────────────────────────────────────────────────────┐
│                    Shared WebSocket Framework             │
│  ┌──────────────────────────────────────────────────┐   │
│  │ WsServer (generic framework)                     │   │
│  │ - Message routing & type safety                  │   │
│  │ - Middleware pipeline                           │   │
│  │ - State management                              │   │
│  │ - Error handling & timeouts                      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

┌─────────────────┐    WebSocket/TLS    ┌──────────────┐
│   Controller    │◄────────────────────►│    Router    │
│                 │                      │              │
│  Phase 1: Auth  │                      │  Phase A:    │
│  Phase 2: RPC   │                      │  - Validate  │
│                 │                      │  - Route     │
└─────────────────┘                      │  - Relay     │
                                         └──────────────┘
                                                ▲
                          WebSocket/TLS         │
                                                │
                         ┌──────────────────────┘
                         │
                    ┌────┴─────┐
                    │ Cardhost  │
                    │           │
                    │ Phase 1:  │
                    │ Auth      │
                    │ Phase 2:  │
                    │ RPC Ready │
                    └───────────┘
```

---

## 🔧 実装順序（全体統合）

### Iteration 1: フレームワーク基盤（共有パッケージ）
1. ✏️ `packages/shared/src/ws-framework/` 作成
   - `types.ts` - メッセージ型定義
   - `ws-server.ts` - WsServer実装
   - `message-router.ts` - ルーター実装
2. ✅ Unit tests

### Iteration 2: Cardhost全改修
1. ✏️ `auth-manager.ts` → WebSocket認証に完全書き直し
2. ✏️ `router-transport.ts` → フレームワーク活用
3. ✏️ `cardhost-service.ts` → 簡略化
4. ✅ Unit tests
5. ✅ Mock Router相手にE2E テスト

### Iteration 3: Controller全改修
1. ✏️ `session-manager.ts` → WebSocket認証に完全書き直し
2. ✏️ `router-transport.ts` → フレームワーク活用
3. ✏️ `controller-client.ts` → 簡略化
4. ✅ Unit tests
5. ✅ Mock Router相手にE2E テスト

### Iteration 4: Router全改修
1. ✏️ `presentation/ws/controller-ws.ts` → フレームワーク活用
2. ✏️ `presentation/ws/cardhost-ws.ts` → フレームワーク活用
3. ❌ `presentation/rest/` 削除
4. ✏️ `server.ts` 簡略化
5. ✅ Integration tests
6. ✅ 全体E2E tests

---

## 🧪 テスト戦略（統合ベース）

### Unit Tests（各モジュール内）
```typescript
// packages/shared/tests/ws-framework.test.ts
test("WsServer message routing", async () => { ... });
test("WsContext state management", async () => { ... });
test("MessageRouter with unknown type", async () => { ... });

// packages/cardhost/tests/router-transport.test.ts
test("Cardhost auth flow", async () => { ... });
test("Cardhost RPC after auth", async () => { ... });

// packages/controller/tests/router-transport.test.ts
test("Controller auth flow", async () => { ... });
test("Controller connect-cardhost", async () => { ... });
test("Controller RPC call", async () => { ... });

// packages/router/tests/ws-handlers.test.ts
test("Controller auth handler", async () => { ... });
test("Cardhost auth handler", async () => { ... });
```

### Integration Tests（モジュール間）
```typescript
// tests/integration/cardhost-router.test.ts
test("Cardhost connects and authenticates with Router", async () => { ... });

// tests/integration/controller-router.test.ts
test("Controller connects, authenticates, and creates session", async () => { ... });

// tests/integration/full-flow.test.ts
test("Full flow: Cardhost + Controller + Router", async () => {
  // 1. Start Router
  // 2. Cardhost connects and authenticates
  // 3. Controller connects and authenticates
  // 4. Controller creates session with Cardhost
  // 5. Controller sends APDU via Router
  // 6. Cardhost responds
  // 7. Controller receives response
});
```

---

## ✅ チェックリスト

### 設計フェーズ
- [x] WebSocketフレームワーク設計
- [x] メッセージプロトコル定義
- [x] 認証フロー設計（全モジュール）
- [x] 実装順序決定

### 実装準備
- [ ] 設計ドキュメント レビュー
- [ ] フレームワーク詳細設計書作成
- [ ] テスト戦略ドキュメント作成

### 実装フェーズ
- [ ] Iteration 1: フレームワーク基盤
- [ ] Iteration 2: Cardhost改修
- [ ] Iteration 3: Controller改修
- [ ] Iteration 4: Router改修

### 完成後
- [ ] すべてのテスト合格
- [ ] ドキュメント更新
- [ ] パフォーマンステスト

---

**次ステップ**:
このドキュメントをレビュー後、Iteration 1（WebSocketフレームワーク基盤）の詳細実装設計書を作成します。
