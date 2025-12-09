# Router API Breaking Changes - 2025-12-09

## 概要

Routerの仕様が大幅に変更されました。この変更は**Controller**と**Cardhost**の実装に影響します。

このドキュメントは、既存の実装（もし存在する場合）が何を変更する必要があるかを明確にするためのものです。

---

## 重要な変更点サマリー

1. **Peer ID/UUID派生方式の変更** - PeerはID/UUIDを選べなくなった
2. **認証フローの変更** - Bearer token廃止、公開鍵認証に統一
3. **REST APIエンドポイントの変更** - パス、リクエスト/レスポンス形式の変更
4. **WebSocket接続要件の変更** - ヘッダー要件の変更

---

## 1. Peer ID/UUID派生方式の変更

### 変更の理由

**セキュリティ脆弱性:** PeerがID/UUIDを自己申告できると、以下のリスクがあります：
- 衝突攻撃（他のPeerのIDを使用）
- 偽装攻撃（既存Peerになりすます）
- 名前空間汚染（意図的な衝突でDoS）

### 新しい方式

**Router側でID/UUIDを派生:**
```
Peer ID/UUID = "peer_" + base64url(SHA-256(publicKey))
```

Peerは公開鍵を送信し、Routerが決定論的にIDを生成します。

---

## 2. Controller実装への影響

### 2.1 認証APIの変更

#### 旧API (Bearer Token方式)

```typescript
// Step 1: 認証
POST /controller/connect
Headers: { Authorization: "Bearer <token>" }
Response: { token: "<session-token>", expiresAt: "..." }

// Step 2: WebSocket接続
WebSocket /api/jsapdu/ws
Headers: { 
  x-role: "controller",
  x-session-token: "<session-token>",
  x-cardhost-uuid: "<uuid>"
}
```

#### 新API (公開鍵認証)

```typescript
// Step 1: 認証開始（Router がController IDを発行）
POST /controller/auth/initiate
Request: { publicKey: "<ed25519-public-key>" }
Response: { 
  controllerId: "peer_<hash>",  // Router派生のID
  challenge: "<random-nonce>" 
}

// Step 2: 認証完了
POST /controller/auth/verify
Request: { 
  controllerId: "peer_<hash>",
  challenge: "<challenge>",
  signature: "<ed25519-signature>" 
}
Response: { ok: true, controllerId: "peer_<hash>" }

// Step 3: セッション作成（識別用）
POST /controller/sessions
Request: { 
  controllerId: "peer_<hash>",
  cardhostUuid: "peer_<hash>" 
}
Response: { token: "<session-token>", expiresAt: "..." }

// Step 4: WebSocket接続
WebSocket /ws/controller
Headers: { 
  x-controller-id: "peer_<hash>",
  x-session-token: "<session-token>"
}
```

### 2.2 Controller実装で必要な変更

#### 必須変更1: 鍵ペア管理

**追加が必要なもの:**
```typescript
// Ed25519鍵ペアの生成と永続化
import { webcrypto } from "node:crypto";

// 初回起動時
const keyPair = await webcrypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"]
);

// ~/.controller/id_ed25519 等に保存
// 次回起動時は既存の鍵を読み込み
```

#### 必須変更2: 署名生成

**追加が必要なもの:**
```typescript
async function signChallenge(
  challenge: string,
  privateKey: CryptoKey
): Promise<string> {
  const payload = Buffer.from(JSON.stringify(challenge), "utf8");
  const signature = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload
  );
  return Buffer.from(signature).toString("base64");
}
```

#### 必須変更3: 接続シーケンスの変更

**旧シーケンス:**
```typescript
// 1ステップ
const { token } = await fetch(`${router}/controller/connect`, {
  headers: { authorization: `Bearer ${bearerToken}` }
}).then(r => r.json());

// WebSocket接続
const ws = new WebSocket(`${router}/api/jsapdu/ws`, {
  headers: {
    'x-role': 'controller',
    'x-session-token': token,
    'x-cardhost-uuid': cardhostUuid
  }
});
```

**新シーケンス:**
```typescript
// 3ステップ
// Step 1: 認証開始
const { controllerId, challenge } = await fetch(
  `${router}/controller/auth/initiate`,
  {
    method: 'POST',
    body: JSON.stringify({ publicKey })
  }
).then(r => r.json());

// Step 2: 署名して認証完了
const signature = await signChallenge(challenge, privateKey);
await fetch(`${router}/controller/auth/verify`, {
  method: 'POST',
  body: JSON.stringify({ controllerId, challenge, signature })
});

// Step 3: セッション作成
const { token: sessionToken } = await fetch(
  `${router}/controller/sessions`,
  {
    method: 'POST',
    body: JSON.stringify({ controllerId, cardhostUuid })
  }
).then(r => r.json());

// Step 4: WebSocket接続
const ws = new WebSocket(`${router}/ws/controller`, {
  headers: {
    'x-controller-id': controllerId,
    'x-session-token': sessionToken
  }
});
```

#### 削除すべきもの

- ❌ Bearer token管理コード
- ❌ `x-role`ヘッダー
- ❌ `x-cardhost-uuid`ヘッダー（WebSocket接続時）
- ❌ `/api/jsapdu/ws`パス
- ❌ `/controller/connect`エンドポイント

#### 追加すべきもの

- ✅ Ed25519鍵ペア管理
- ✅ チャレンジ署名ロジック
- ✅ Controller ID保存（Router派生のIDを記録）
- ✅ 3ステップ認証フロー
- ✅ セッション作成API呼び出し

---

## 3. Cardhost実装への影響

### 3.1 認証APIの変更

#### 旧API

```typescript
// Step 1: 認証開始
POST /cardhost/connect
Request: { uuid: "<自己申告UUID>", publicKey: "<key>" }
Response: { challenge: "<nonce>" }

// Step 2: 認証完了
POST /cardhost/verify
Request: { uuid: "<同じUUID>", challenge: "<challenge>", signature: "<sig>" }
Response: { ok: true }

// Step 3: WebSocket接続
WebSocket /api/jsapdu/ws
Headers: { 
  x-role: "cardhost",
  x-cardhost-uuid: "<自己申告UUID>"
}
```

#### 新API

```typescript
// Step 1: 認証開始（Router がUUIDを発行）
POST /cardhost/connect
Request: { publicKey: "<ed25519-public-key>" }
Response: { 
  uuid: "peer_<hash>",      // Router派生のUUID
  challenge: "<random-nonce>" 
}

// Step 2: 認証完了
POST /cardhost/verify
Request: { 
  uuid: "peer_<hash>",      // Router派生のUUIDを使用
  challenge: "<challenge>",
  signature: "<ed25519-signature>" 
}
Response: { ok: true }

// Step 3: WebSocket接続
WebSocket /ws/cardhost
Headers: { 
  x-cardhost-uuid: "peer_<hash>"  // Router派生のUUIDを使用
}
```

### 3.2 Cardhost実装で必要な変更

#### 必須変更1: UUID管理の変更

**旧実装:**
```typescript
// Cardhostが自分でUUIDを生成/管理
const uuid = loadOrGenerateUuid(); // 128-bit UUID
await fetch(`${router}/cardhost/connect`, {
  body: JSON.stringify({ uuid, publicKey })
});
```

**新実装:**
```typescript
// Routerから発行されたUUIDを取得して保存
const { uuid, challenge } = await fetch(`${router}/cardhost/connect`, {
  method: 'POST',
  body: JSON.stringify({ publicKey })
}).then(r => r.json());

// Router派生のUUIDを永続化
saveUuid(uuid);  // 次回起動時に使用
```

#### 必須変更2: UUID検証

**重要:** Routerから受け取ったUUIDが公開鍵から正しく派生されているか検証すべきです：

```typescript
import { createHash } from "node:crypto";

function verifyUuid(uuid: string, publicKey: string): boolean {
  const publicKeyBytes = Buffer.from(publicKey, "base64");
  const hash = createHash("sha256").update(publicKeyBytes).digest();
  const expectedUuid = "peer_" + hash.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  
  return uuid === expectedUuid;
}
```

#### 削除すべきもの

- ❌ UUID自己生成ロジック（初回起動時）
- ❌ `x-role`ヘッダー
- ❌ `/api/jsapdu/ws`パス

#### 追加すべきもの

- ✅ Router発行UUIDの受信と永続化
- ✅ UUID検証ロジック（オプションだが推奨）
- ✅ 公開鍵とUUIDの紐付け管理

---

## 4. API比較表

### Controller Authentication

| 項目 | 旧API | 新API | 変更の影響 |
|------|-------|-------|-----------|
| 認証方式 | Bearer token | Ed25519公開鍵 | **破壊的変更** |
| ID決定 | Controllerが選択 | Router派生 | **破壊的変更** |
| 認証ステップ | 1ステップ | 2ステップ | **破壊的変更** |
| セッション作成 | 認証と同時 | 認証後に別途 | **破壊的変更** |
| WebSocketパス | `/api/jsapdu/ws` | `/ws/controller` | **破壊的変更** |
| x-role | 必須 | 削除 | **破壊的変更** |
| x-controller-id | なし | 必須 | **新規追加** |

### Cardhost Authentication

| 項目 | 旧API | 新API | 変更の影響 |
|------|-------|-------|-----------|
| UUID決定 | Cardhostが選択 | Router派生 | **破壊的変更** |
| UUID送信 | Step 1で送信 | Step 1で受信 | **破壊的変更** |
| WebSocketパス | `/api/jsapdu/ws` | `/ws/cardhost` | **破壊的変更** |
| x-role | 必須 | 削除 | **破壊的変更** |

### REST API Endpoints

| 旧エンドポイント | 新エンドポイント | 変更 |
|----------------|----------------|------|
| `POST /controller/connect` | `POST /controller/auth/initiate` | **名称変更・機能分割** |
| なし | `POST /controller/auth/verify` | **新規追加** |
| `POST /sessions` | `POST /controller/sessions` | **パス変更** |
| `GET /cardhosts` | `GET /controller/cardhosts` | **パス変更** |
| `POST /cardhost/connect` | `POST /cardhost/connect` | **レスポンス形式変更** |
| `POST /cardhost/verify` | `POST /cardhost/verify` | **変更なし** |

---

## 5. 実装チェックリスト

### Controller実装者向け

- [ ] Ed25519鍵ペアの生成と永続化
- [ ] チャレンジ署名ロジックの実装
- [ ] 認証APIの3ステップフローへの変更
- [ ] Router派生Controller IDの取得と保存
- [ ] セッション作成APIの呼び出し追加
- [ ] WebSocketパスの変更（`/ws/controller`）
- [ ] WebSocketヘッダーの変更（`x-controller-id`追加、`x-role`削除）
- [ ] Bearer token関連コードの削除
- [ ] `x-cardhost-uuid`ヘッダーの削除（WebSocket接続時）

### Cardhost実装者向け

- [ ] UUID自己生成ロジックの削除
- [ ] 認証開始時のリクエストボディ変更（`uuid`削除）
- [ ] Router発行UUIDの受信と永続化
- [ ] UUID検証ロジックの実装（推奨）
- [ ] WebSocketパスの変更（`/ws/cardhost`）
- [ ] `x-role`ヘッダーの削除
- [ ] 公開鍵とUUIDの紐付け管理

---

## 6. 詳細な実装ガイド

### 6.1 Controller: 鍵ペア管理

```typescript
import { webcrypto } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_DIR = join(homedir(), ".controller");
const PUBLIC_KEY_PATH = join(KEY_DIR, "id_ed25519.pub");
const PRIVATE_KEY_PATH = join(KEY_DIR, "id_ed25519");

async function loadOrGenerateKeyPair() {
  if (existsSync(PUBLIC_KEY_PATH) && existsSync(PRIVATE_KEY_PATH)) {
    // Load existing keys
    const publicKey = readFileSync(PUBLIC_KEY_PATH, "utf8");
    const privateKeyPkcs8 = readFileSync(PRIVATE_KEY_PATH, "base64");
    
    const privateKey = await webcrypto.subtle.importKey(
      "pkcs8",
      Buffer.from(privateKeyPkcs8, "base64"),
      { name: "Ed25519" },
      true,
      ["sign"]
    );
    
    return { publicKey, privateKey };
  }
  
  // Generate new keypair
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  ) as CryptoKeyPair;
  
  const publicKeySpki = await webcrypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKeyPkcs8 = await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  
  const publicKey = Buffer.from(publicKeySpki).toString("base64");
  
  // Save keys
  writeFileSync(PUBLIC_KEY_PATH, publicKey, "utf8");
  writeFileSync(PRIVATE_KEY_PATH, Buffer.from(privateKeyPkcs8).toString("base64"), "utf8");
  
  return { publicKey, privateKey: keyPair.privateKey };
}
```

### 6.2 Controller: 新しい認証フロー

```typescript
async function authenticateAndConnect(routerUrl: string, cardhostUuid: string) {
  const { publicKey, privateKey } = await loadOrGenerateKeyPair();
  
  // Step 1: 認証開始
  const { controllerId, challenge } = await fetch(
    `${routerUrl}/controller/auth/initiate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey })
    }
  ).then(r => r.json());
  
  console.log(`Controller ID: ${controllerId}`); // Router派生のID
  
  // Step 2: チャレンジに署名
  const payload = Buffer.from(JSON.stringify(challenge), "utf8");
  const signatureBuffer = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload
  );
  const signature = Buffer.from(signatureBuffer).toString("base64");
  
  // Step 3: 認証完了
  await fetch(`${routerUrl}/controller/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ controllerId, challenge, signature })
  });
  
  // Step 4: セッション作成
  const { token: sessionToken } = await fetch(
    `${routerUrl}/controller/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ controllerId, cardhostUuid })
    }
  ).then(r => r.json());
  
  // Step 5: WebSocket接続
  const ws = new WebSocket(`${routerUrl.replace('http', 'ws')}/ws/controller`, {
    headers: {
      "x-controller-id": controllerId,
      "x-session-token": sessionToken
    }
  });
  
  return { ws, controllerId, sessionToken };
}
```

### 6.3 Cardhost: 新しい認証フロー

```typescript
async function authenticateCardhost(routerUrl: string) {
  const { publicKey, privateKey } = await loadOrGenerateKeyPair();
  
  // Step 1: 認証開始（UUIDを取得）
  const { uuid, challenge } = await fetch(
    `${routerUrl}/cardhost/connect`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey })
    }
  ).then(r => r.json());
  
  console.log(`Cardhost UUID: ${uuid}`); // Router派生のUUID
  
  // UUIDを永続化（次回起動時に使用）
  saveUuid(uuid);
  
  // Step 2: チャレンジに署名
  const payload = Buffer.from(JSON.stringify(challenge), "utf8");
  const signatureBuffer = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    payload
  );
  const signature = Buffer.from(signatureBuffer).toString("base64");
  
  // Step 3: 認証完了
  await fetch(`${routerUrl}/cardhost/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uuid, challenge, signature })
  });
  
  // Step 4: WebSocket接続
  const ws = new WebSocket(`${routerUrl.replace('http', 'ws')}/ws/cardhost`, {
    headers: {
      "x-cardhost-uuid": uuid
    }
  });
  
  return { ws, uuid };
}
```

### 6.4 Cardhost: UUID永続化

**重要な変更点:**

```typescript
// 旧実装: Cardhostが自分でUUIDを生成
const uuid = existsSync(UUID_FILE) 
  ? readFileSync(UUID_FILE, "utf8")
  : generateUuid(); // 自己生成

// 新実装: Routerから受け取ったUUIDを保存
function saveUuid(uuid: string) {
  writeFileSync(UUID_FILE, uuid, "utf8");
}

function loadSavedUuid(): string | null {
  return existsSync(UUID_FILE) 
    ? readFileSync(UUID_FILE, "utf8")
    : null;
}

// 初回起動: Routerから取得して保存
// 再起動: 保存済みUUIDを読み込み（変更なし）
```

---

## 7. セキュリティ上の重要な注意点

### Controller/Cardhost共通

1. **秘密鍵の安全な保管**
   - ファイルパーミッション: 0600 (所有者のみ読み書き可能)
   - 暗号化ストレージの使用（推奨）
   
2. **Router派生IDの検証**
   - 受け取ったID/UUIDが公開鍵から正しく派生されているか検証
   - 中間者攻撃対策

3. **チャレンジの一回限り使用**
   - チャレンジは一度使用したら破棄
   - 再認証時は新しいチャレンジを取得

---

## 8. マイグレーションチェックリスト

### Controller

```bash
# 移行前の確認
□ 既存のbearer token管理コードを特定
□ 既存の認証フローを文書化
□ 既存のWebSocket接続コードを特定

# 移行作業
□ Ed25519鍵ペア生成・永続化を実装
□ チャレンジ署名ロジックを実装
□ 新しい3ステップ認証フローを実装
□ セッション作成APIを実装
□ WebSocketパス/ヘッダーを更新
□ 旧コードの削除

# 移行後の確認
□ 新しいフローで認証が成功するか
□ WebSocket接続が確立するか
□ APDUコマンドが送受信できるか
```

### Cardhost

```bash
# 移行前の確認
□ 既存のUUID生成ロジックを特定
□ UUID永続化の仕組みを確認
□ 既存の認証フローを文書化

# 移行作業
□ UUID自己生成ロジックを削除
□ Router発行UUID受信ロジックを実装
□ UUID検証ロジックを実装（推奨）
□ WebSocketパス/ヘッダーを更新
□ `x-role`ヘッダーを削除

# 移行後の確認
□ Router派生UUIDが正しく取得できるか
□ UUIDが永続化されるか
□ 再起動後も同じUUIDが使用されるか
□ WebSocket接続が確立するか
□ APDUコマンドを受信・処理できるか
```

---

## 9. トラブルシューティング

### よくあるエラー

#### エラー1: "Controller not authenticated"

**原因:** 認証完了前にセッション作成を試みている

**解決策:**
```typescript
// 正しい順序
await initiateAuth();
await verifyAuth();
await createSession();  // この順番を守る
```

#### エラー2: "Cardhost UUID does not match public key"

**原因:** 自己申告UUIDを送信している

**解決策:**
```typescript
// 誤り
const uuid = generateMyOwnUuid();
POST /cardhost/connect { uuid, publicKey }

// 正しい
POST /cardhost/connect { publicKey }
const { uuid } = await response.json();  // Router派生のUUIDを使用
```

#### エラー3: "Session does not belong to this controller"

**原因:** 他のControllerのセッショントークンを使用

**解決策:**
各Controllerは自分のセッションのみ使用すること

---

## 10. 参考実装

実装例は以下を参照：

- Router実装: [`packages/router/src`](../../packages/router/src)
- Routerテスト: [`packages/router/tests`](../../packages/router/tests)
- 認証ヘルパー: [`packages/router/tests/helpers/auth-helpers.ts`](../../packages/router/tests/helpers/auth-helpers.ts)
- 暗号化ヘルパー: [`packages/router/tests/helpers/crypto.ts`](../../packages/router/tests/helpers/crypto.ts)

---

## 11. タイムライン

- **変更日**: 2025-12-09
- **影響範囲**: Controller, Cardhost
- **後方互換性**: なし（完全な破壊的変更）
- **移行期限**: 未定（リリース前のため影響なし）

---

**このドキュメントは、Controller/Cardhostの実装者がRouterの仕様変更に対応するためのガイドです。**

**連絡先:** 実装に関する質問は開発チームまで
