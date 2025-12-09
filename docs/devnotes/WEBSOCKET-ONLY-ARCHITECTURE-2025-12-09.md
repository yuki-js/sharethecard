# WebSocketオンリーアーキテクチャ実装指示書

**Date**: 2025-12-09  
**Status**: 設計完了 - 実装待ち  
**Estimated Effort**: 2-3 hours

---

## 🎯 設計原則

### ゼロHTTP原則
> すべての通信はWebSocketで行う。HTTP RESTは一切使用しない。

### 接続=アイデンティティ原則
> WebSocket接続自体がクライアントのアイデンティティ。クライアントはUUID/IDを送信しない。

### ステートフル通信原則
> 持続的接続が必要なシステムは最初からステートフルプロトコルを使うべき。

---

## 📋 メッセージプロトコル仕様

### 共通メッセージフォーマット

```typescript
interface BaseMessage {
  type: string;
  id?: string; // 要求/応答の相関用（オプション）
}

interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
}
```

---

## 🔐 Cardhost認証プロトコル

### フロー

```
Client                                    Router
  │                                         │
  │  ─────WebSocket /ws/cardhost────────>  │
  │                                         │
  │  { type: "auth-init",                  │
  │    publicKey: "base64..." }            │
  │  ──────────────────────────────────>   │
  │                                         │
  │                    Router derives UUID  │
  │                    uuid = peer_hash    │
  │                                         │
  │  { type: "auth-challenge",             │
  │    uuid: "peer_...",                   │
  │    challenge: "nonce..." }             │
  │  <──────────────────────────────────   │
  │                                         │
  │  Verify uuid matches publicKey         │
  │  Sign challenge                        │
  │                                         │
  │  { type: "auth-verify",                │
  │    signature: "base64..." }            │
  │  ──────────────────────────────────>   │
  │                                         │
  │                    Verify signature     │
  │                    Map: ws → uuid       │
  │                                         │
  │  { type: "auth-success",               │
  │    uuid: "peer_..." }                  │
  │  <──────────────────────────────────   │
  │                                         │
  │  ────────RPC通信開始────────────────>  │
  │                                         │
```

### メッセージ定義

```typescript
// 1. 認証開始（Client → Router）
interface AuthInitMessage {
  type: "auth-init";
  publicKey: string; // Ed25519 public key (SPKI, base64)
}

// 2. チャレンジ（Router → Client）
interface AuthChallengeMessage {
  type: "auth-challenge";
  uuid: string; // Router-derived UUID (peer_...)
  challenge: string; // Random nonce
}

// 3. 署名検証（Client → Router）
interface AuthVerifyMessage {
  type: "auth-verify";
  signature: string; // Ed25519 signature of challenge
}

// 4. 認証成功（Router → Client）
interface AuthSuccessMessage {
  type: "auth-success";
  uuid: string; // Confirmed UUID
}
```

---

## 🎮 Controller認証プロトコル

### フロー

```
Client                                    Router
  │                                         │
  │  ─────WebSocket /ws/controller───────> │
  │                                         │
  │  { type: "auth-init",                  │
  │    publicKey: "base64..." }            │
  │  ──────────────────────────────────>   │
  │                                         │
  │                Router derives ID        │
  │                controllerId = peer_hash │
  │                                         │
  │  { type: "auth-challenge",             │
  │    controllerId: "peer_...",           │
  │    challenge: "nonce..." }             │
  │  <──────────────────────────────────   │
  │                                         │
  │  Verify controllerId                   │
  │  Sign challenge                        │
  │                                         │
  │  { type: "auth-verify",                │
  │    signature: "base64..." }            │
  │  ──────────────────────────────────>   │
  │                                         │
  │                    Verify signature     │
  │                    Map: ws → ctrlId     │
  │                                         │
  │  { type: "auth-success" }              │
  │  <──────────────────────────────────   │
  │                                         │
  │  { type: "connect-cardhost",           │
  │    cardhostUuid: "peer_..." }          │
  │  ──────────────────────────────────>   │
  │                                         │
  │                    Create session       │
  │                    ws → cardhost UUID   │
  │                                         │
  │  { type: "connected" }                 │
  │  <──────────────────────────────────   │
  │                                         │
  │  ────────RPC通信開始────────────────>  │
  │                                         │
```

### メッセージ定義

```typescript
// 1. 認証開始（Client → Router）
interface ControllerAuthInitMessage {
  type: "auth-init";
  publicKey: string;
}

// 2. チャレンジ（Router → Client）
interface ControllerAuthChallengeMessage {
  type: "auth-challenge";
  controllerId: string; // Router-derived ID
  challenge: string;
}

// 3. 署名検証（Client → Router）
interface ControllerAuthVerifyMessage {
  type: "auth-verify";
  signature: string;
}

// 4. 認証成功（Router → Client）
interface ControllerAuthSuccessMessage {
  type: "auth-success";
  controllerId: string; // Confirmed ID
}

// 5. Cardhost接続要求（Client → Router）
interface ConnectCardhostMessage {
  type: "connect-cardhost";
  cardhostUuid: string; // Target cardhost UUID
}

// 6. 接続完了（Router → Client）
interface ConnectedMessage {
  type: "connected";
  cardhostUuid: string;
}
```

---

## 🔧 実装ガイド

### Phase 1: Cardhost実装

#### 1.1 router-transport.ts の変更

**削除するもの**:
- HTTPベースの認証コード（auth-manager.ts との連携）

**追加するもの**:
```typescript
export class RouterServerTransport implements ServerTransport {
  private authenticated = false;
  private uuid: string | null = null;

  async start(): Promise<void> {
    // WebSocket接続
    this.ws = new WebSocket(`${wsUrl}/ws/cardhost`);
    
    this.ws.on("open", async () => {
      // 接続後すぐに認証開始
      await this.authenticate();
    });

    this.ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());
      
      if (!this.authenticated) {
        // 認証中のメッセージ処理
        await this.handleAuthMessage(msg);
      } else {
        // RPC処理
        await this.handleRpcMessage(msg);
      }
    });
  }

  private async authenticate(): Promise<void> {
    const { publicKey } = await loadKeys();
    
    // 1. 認証開始
    this.send({ type: "auth-init", publicKey });
    
    // 2. チャレンジ待機（handleAuthMessageで処理）
  }

  private async handleAuthMessage(msg: any): Promise<void> {
    if (msg.type === "auth-challenge") {
      const { uuid, challenge } = msg;
      
      // UUID検証
      await verifyDerivedUuid(uuid, publicKey);
      
      // 署名
      const signature = await signChallenge(challenge, privateKey);
      
      // 3. 検証要求
      this.send({ type: "auth-verify", signature });
    }
    
    if (msg.type === "auth-success") {
      this.authenticated = true;
      this.uuid = msg.uuid;
      logger.info("Authentication successful", { uuid: this.uuid });
    }
    
    if (msg.type === "error") {
      throw new Error(`Auth failed: ${msg.message}`);
    }
  }
}
```

#### 1.2 cardhost-service.ts の変更

```typescript
async connect(): Promise<void> {
  // 設定ロード
  let config = await this.configManager.loadOrCreate(routerUrl);

  // トランスポート作成（認証はtransport内部で実行）
  this.transport = new RouterServerTransport({
    routerUrl: this.authManager.getRouterUrl(),
  });

  // アダプター作成
  this.adapter = new SmartCardPlatformAdapter(this.platform, this.transport);

  // 開始（内部で認証も実行される）
  await this.adapter.start();

  // 認証完了後、UUIDを取得して保存
  const derivedUuid = this.transport.getUuid();
  if (derivedUuid !== config.uuid) {
    await this.configManager.updateUuid(derivedUuid);
  }

  this.connected = true;
}
```

#### 1.3 auth-manager.ts の変更

**オプション1**: 完全削除（認証ロジックは router-transport.ts に統合）

**オプション2**: ユーティリティ関数のみ残す
```typescript
// 署名生成とUUID検証のみ提供
export class AuthUtils {
  static async signChallenge(challenge: string, privateKey: string): Promise<string> {
    // 実装
  }
  
  static async verifyDerivedUuid(uuid: string, publicKey: string): Promise<void> {
    // 実装
  }
}
```

---

### Phase 2: Controller実装

#### 2.1 router-transport.ts の変更

```typescript
export class RouterClientTransport implements ClientTransport {
  private authenticated = false;
  private controllerId: string | null = null;
  private connected = false;

  async connect(): Promise<void> {
    this.ws = new WebSocket(`${wsUrl}/ws/controller`);
    
    this.ws.on("open", async () => {
      await this.authenticate();
    });

    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      
      if (!this.authenticated) {
        this.handleAuthMessage(msg);
      } else {
        this.handleDataMessage(msg);
      }
    });
  }

  private async authenticate(): Promise<void> {
    const { publicKey } = await this.keyManager.loadOrGenerate();
    
    this.send({ type: "auth-init", publicKey });
  }

  private async handleAuthMessage(msg: any): Promise<void> {
    if (msg.type === "auth-challenge") {
      const { controllerId, challenge } = msg;
      
      // ID検証
      await this.keyManager.verifyControllerId(controllerId, publicKey);
      
      // 署名
      const signature = await this.keyManager.signChallenge(challenge);
      
      this.send({ type: "auth-verify", signature });
    }
    
    if (msg.type === "auth-success") {
      this.authenticated = true;
      this.controllerId = msg.controllerId;
      logger.info("Authentication successful", { controllerId });
    }
  }

  async connectToCardhost(cardhostUuid: string): Promise<void> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }
    
    this.send({ type: "connect-cardhost", cardhostUuid });
    
    // 応答待機
    await this.waitForMessage("connected");
    this.connected = true;
  }

  async call(request: RpcRequest): Promise<RpcResponse> {
    if (!this.connected) {
      throw new Error("Not connected to cardhost");
    }
    
    // 通常のRPC処理
    this.send(request);
    return await this.waitForResponse(request.id);
  }
}
```

#### 2.2 controller-client.ts の変更

```typescript
async connect(cardhostUuid?: string): Promise<void> {
  const uuid = cardhostUuid ?? this.config.cardhostUuid;
  
  if (!uuid) {
    throw new SmartCardError("INVALID_PARAMETER", "Cardhost UUID required");
  }

  // トランスポート作成と接続
  this.transport = new RouterClientTransport({
    routerUrl: this.config.routerUrl,
    keyManager: this.config.keyManager,
  });

  // 接続（内部で認証実行）
  await this.transport.connect();
  
  // Cardhost接続
  await this.transport.connectToCardhost(uuid);

  // プラットフォーム作成
  this.platform = new RemoteSmartCardPlatform(this.transport);
  await this.platform.init(true);

  this.connectedCardhostUuid = uuid;
}
```

#### 2.3 session-manager.ts の削除

**完全削除**: WebSocketベース認証に統合されるため不要

---

### Phase 3: Router実装

#### 3.1 WebSocketハンドラの統合

```typescript
// server.ts
wss.on("connection", (ws, req) => {
  const url = req.url || "";

  if (url.startsWith("/ws/controller")) {
    handleControllerWebSocket(ws, router);
  } else if (url.startsWith("/ws/cardhost")) {
    handleCardhostWebSocket(ws, router);
  } else {
    ws.close(1008, "Invalid path");
  }
});
```

#### 3.2 cardhost-ws.ts の完全書き直し

```typescript
export function handleCardhostWebSocket(
  ws: WebSocket,
  router: Router,
): void {
  let authenticated = false;
  let cardhostUuid: string | null = null;
  let publicKey: string | null = null;

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (!authenticated) {
        // 認証フロー
        if (msg.type === "auth-init") {
          publicKey = msg.publicKey;
          const { uuid, challenge } = await router.cardhostUseCase.initiateAuth(publicKey);
          
          ws.send(JSON.stringify({
            type: "auth-challenge",
            uuid,
            challenge,
          }));
        }
        
        if (msg.type === "auth-verify") {
          const isValid = await router.cardhostUseCase.verifyAuth(
            cardhostUuid!, // UUIDは前のステップで確定
            challenge,
            msg.signature,
          );
          
          if (isValid) {
            authenticated = true;
            router.transportUseCase.registerCardhost(cardhostUuid!, (data) => {
              ws.send(JSON.stringify(data));
            });
            
            ws.send(JSON.stringify({
              type: "auth-success",
              uuid: cardhostUuid,
            }));
          } else {
            ws.send(JSON.stringify({
              type: "error",
              code: "AUTH_FAILED",
              message: "Signature verification failed",
            }));
            ws.close();
          }
        }
      } else {
        // RPC処理
        router.transportUseCase.handleCardhostData(cardhostUuid!, msg);
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      }));
    }
  });

  ws.on("close", () => {
    if (authenticated && cardhostUuid) {
      router.transportUseCase.unregisterCardhost(cardhostUuid);
      router.cardhostUseCase.disconnect(cardhostUuid);
    }
  });
}
```

#### 3.3 controller-ws.ts の完全書き直し

```typescript
export function handleControllerWebSocket(
  ws: WebSocket,
  router: Router,
): void {
  let authenticated = false;
  let controllerId: string | null = null;
  let sessionEstablished = false;
  let sessionToken: string | null = null;

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (!authenticated) {
        // 認証フロー
        if (msg.type === "auth-init") {
          const { controllerId: id, challenge } = 
            await router.controllerUseCase.initiateAuth(msg.publicKey);
          
          controllerId = id;
          
          ws.send(JSON.stringify({
            type: "auth-challenge",
            controllerId,
            challenge,
          }));
        }
        
        if (msg.type === "auth-verify") {
          const isValid = await router.controllerUseCase.verifyAuth(
            controllerId!,
            challenge,
            msg.signature,
          );
          
          if (isValid) {
            authenticated = true;
            
            ws.send(JSON.stringify({
              type: "auth-success",
              controllerId,
            }));
          } else {
            ws.send(JSON.stringify({
              type: "error",
              code: "AUTH_FAILED",
              message: "Signature verification failed",
            }));
            ws.close();
          }
        }
      } else if (!sessionEstablished) {
        // Cardhost接続フロー
        if (msg.type === "connect-cardhost") {
          const { cardhostUuid } = msg;
          
          // セッション作成
          const session = router.controllerUseCase.createSession(
            controllerId!,
            cardhostUuid,
          );
          
          sessionToken = session.token;
          sessionEstablished = true;
          
          // トランスポート登録
          router.transportUseCase.registerController(sessionToken, (data) => {
            ws.send(JSON.stringify(data));
          });
          
          ws.send(JSON.stringify({
            type: "connected",
            cardhostUuid,
          }));
        }
      } else {
        // RPC処理
        const response = await router.transportUseCase.relayFromController(
          sessionToken!,
          msg,
        );
        
        ws.send(JSON.stringify(response));
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      }));
    }
  });

  ws.on("close", () => {
    if (sessionToken) {
      router.transportUseCase.unregisterController(sessionToken);
    }
  });
}
```

#### 3.4 REST API の削除

**完全削除可能**:
- `packages/router/src/presentation/rest/cardhost-routes.ts`
- `packages/router/src/presentation/rest/controller-routes.ts`

**server.ts から削除**:
```typescript
// DELETE: これらのルート定義を削除
// app.route("/", controllerRoutes);
// app.route("/", cardhostRoutes);
```

**保持するREST API**:
```typescript
// Health check and stats only
app.get("/health", ...);
app.get("/stats", ...);
```

---

## 📊 削除されるファイル

### Cardhost
- ❌ `auth-manager.ts` (オプション: ユーティリティのみ残す)

### Controller
- ❌ `session-manager.ts`
- ❌ `commands/*` の `--token` パラメータ処理

### Router
- ❌ `presentation/rest/cardhost-routes.ts`
- ❌ `presentation/rest/controller-routes.ts`

---

## 📊 変更されるファイル

### Cardhost (4 files)
1. ✏️ `router-transport.ts` - WebSocket認証統合
2. ✏️ `cardhost-service.ts` - 認証フロー簡略化
3. ✏️ `config-manager.ts` - UUID更新ロジック調整
4. ✏️ `auth-manager.ts` → `auth-utils.ts` (rename + simplify)

### Controller (4 files)
1. ✏️ `router-transport.ts` - WebSocket認証統合 + RPC
2. ✏️ `controller-client.ts` - 認証フロー簡略化
3. ✏️ `key-manager.ts` - 変更なし（そのまま使用）
4. ✏️ `commands/*` - `--token` 削除確認

### Router (3 files)
1. ✏️ `presentation/ws/cardhost-ws.ts` - 完全書き直し
2. ✏️ `presentation/ws/controller-ws.ts` - 完全書き直し
3. ✏️ `server.ts` - REST route削除、WS統合

---

## 🧪 テスト戦略

### Phase 1: Unit Tests
```typescript
// WebSocket認証メッセージハンドリング
test("cardhost auth flow", async () => {
  const ws = new MockWebSocket();
  const transport = new RouterServerTransport({ routerUrl: "..." });
  
  // 1. 接続
  await transport.start();
  
  // 2. auth-init送信確認
  expect(ws.sent[0]).toEqual({ type: "auth-init", publicKey: "..." });
  
  // 3. challenge受信シミュレート
  ws.receive({ type: "auth-challenge", uuid: "peer_...", challenge: "..." });
  
  // 4. verify送信確認
  expect(ws.sent[1]).toEqual({ type: "auth-verify", signature: "..." });
  
  // 5. success受信シミュレート
  ws.receive({ type: "auth-success", uuid: "peer_..." });
  
  // 6. 認証完了確認
  expect(transport.isAuthenticated()).toBe(true);
});
```

### Phase 2: Integration Tests
```typescript
test("full cardhost-router-controller flow", async () => {
  const router = await startTestRouter();
  
  // 1. Cardhost接続
  const cardhost = new CardhostService({ routerUrl, platform: mockPlatform });
  await cardhost.connect();
  const uuid = cardhost.getUuid();
  
  // 2. Controller接続
  const controller = new ControllerClient({ routerUrl });
  await controller.connect(uuid);
  
  // 3. APDU送信
  const response = await controller.transmit(command);
  
  expect(response.sw).toBe(0x9000);
});
```

---

## ⚡ 実装順序（推奨）

### Day 1: Cardhost
1. ✅ `auth-utils.ts` 作成（署名・検証ユーティリティ）
2. ✅ `router-transport.ts` 変更（WebSocket認証）
3. ✅ `cardhost-service.ts` 変更（統合）
4. ✅ Unit tests

### Day 2: Controller  
1. ✅ `router-transport.ts` 変更（WebSocket認証 + RPC）
2. ✅ `controller-client.ts` 変更（統合）
3. ✅ CLI commands更新
4. ✅ Unit tests

### Day 3: Router
1. ✅ `cardhost-ws.ts` 書き直し
2. ✅ `controller-ws.ts` 書き直し
3. ✅ `server.ts` 統合
4. ✅ REST routes削除
5. ✅ Integration tests

---

## 🎉 完成後の状態

### アーキテクチャ
```
┌────────────┐ WebSocket   ┌────────┐ WebSocket  ┌──────────┐
│ Controller ├────────────>│ Router │<──────────┤ Cardhost │
└────────────┘             └────────┘            └──────────┘
     │                          │                      │
     │                          │                      │
  [Auth]                     [Relay]                [Auth]
  [RPC]                      [Session]              [RPC]
```

### 通信パターン
```
すべてWebSocket over TLS:
- 認証メッセージ
- RPC要求/応答
- イベント通知
- エラーハンドリング
```

### セキュリティ
- ✅ UUID/ID送信なし（接続=アイデンティティ）
- ✅ E2E暗号化（jsapdu-over-ip層）
- ✅ Ed25519公開鍵認証
- ✅ Router派生ID/UUID
- ✅ 単一プロトコル（攻撃面縮小）

---

## 📚 参考実装パターン

### WebSocket認証の一般パターン
```typescript
class AuthenticatedWebSocket {
  private phase: "connecting" | "authenticating" | "authenticated" = "connecting";
  
  async connect() {
    this.ws = new WebSocket(url);
    this.ws.on("open", () => this.startAuth());
    this.ws.on("message", (data) => this.handleMessage(data));
  }
  
  private async startAuth() {
    this.phase = "authenticating";
    this.send({ type: "auth-init", ... });
  }
  
  private async handleMessage(data) {
    const msg = JSON.parse(data);
    
    switch (this.phase) {
      case "authenticating":
        await this.handleAuthMessage(msg);
        break;
      case "authenticated":
        await this.handleDataMessage(msg);
        break;
    }
  }
}
```

---

## ✅ Checklist

### Before Implementation
- [ ] チーム全体が設計を理解
- [ ] テスト戦略に合意
- [ ] バックアップ取得

### During Implementation
- [ ] Cardhostから開始（シンプル）
- [ ] 各コンポーネントでUnit test合格
- [ ] Integration testで統合確認

### After Implementation
- [ ] すべてのテスト合格
- [ ] E2Eテスト実施
- [ ] ドキュメント更新
- [ ] パフォーマンステスト

---

**実装指示書完成**

この指示書に従えば、HTTPを完全に排除したWebSocketオンリーアーキテクチャを実装できます。
推定実装時間: 2-3日（テスト含む）