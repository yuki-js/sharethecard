# Router Authentication Redesign - 2025-12-09

## 概要

Controllerの認証方式をbearer tokenベースから公開鍵暗号ベースに変更しました。

## 重要な変更点

### 認証と識別の分離

**以前の問題:**
- セッショントークンが「認証」と「識別」の両方の役割を担っていた
- Bearer tokenで認証し、そのままセッショントークンとして使用

**新しい設計:**
```
認証層: 公開鍵チャレンジ-レスポンス認証
    ↓
識別層: セッショントークンでcardhost接続先を識別
    ↓
トランスポート層: 透過的なデータリレー
```

## 新しい認証フロー

### Controller Authentication Flow

```
1. POST /controller/auth/initiate
   Request: { controllerId, publicKey }
   Response: { challenge }
   
2. Controller signs challenge with private key

3. POST /controller/auth/verify
   Request: { controllerId, challenge, signature }
   Response: { ok: true, controllerId }
   
4. POST /controller/sessions
   Request: { controllerId, cardhostUuid }
   Response: { token, expiresAt }  // Session token for identification
   
5. WebSocket /ws/controller
   Headers: 
     - x-controller-id: <controllerId>
     - x-session-token: <sessionToken>
```

### Cardhost Authentication Flow (変更なし)

```
1. POST /cardhost/connect
   Request: { uuid, publicKey }
   Response: { challenge }
   
2. Cardhost signs challenge with private key

3. POST /cardhost/verify
   Request: { uuid, challenge, signature }
   Response: { ok: true }
   
4. WebSocket /ws/cardhost
   Headers: 
     - x-cardhost-uuid: <uuid>
```

## アーキテクチャ変更

### 新しいコンポーネント

1. **ControllerRepository** ([`controller-repository.ts`](../../packages/router/src/repository/controller-repository.ts))
   - Controllerの登録情報と認証状態を管理
   - Cardhostと同様のチャレンジ管理

2. **ControllerAuthService** ([`controller-auth-service.ts`](../../packages/router/src/service/controller-auth-service.ts))
   - Ed25519公開鍵チャレンジ-レスポンス認証
   - CardhostAuthServiceと同じパターン

3. **SessionService** - 役割の明確化
   - **以前**: 認証 + 識別
   - **現在**: 識別のみ
   - `bearerToken`フィールドを削除、`controllerId`に変更

### 更新されたコンポーネント

1. **ControllerUseCase** ([`controller-usecase.ts`](../../packages/router/src/usecase/controller-usecase.ts))
   ```typescript
   // 認証メソッド
   initiateAuth(controllerId, publicKey): Promise<string>
   verifyAuth(controllerId, challenge, signature): Promise<boolean>
   isAuthenticated(controllerId): boolean
   
   // セッション（識別）メソッド
   createSession(controllerId, cardhostUuid): SessionToken
   validateSession(sessionToken): boolean
   getCardhostForSession(sessionToken): string | undefined
   getControllerForSession(sessionToken): string | undefined
   ```

2. **Controller REST Routes** ([`controller-routes.ts`](../../packages/router/src/presentation/rest/controller-routes.ts))
   - `/controller/auth/initiate` - 認証開始
   - `/controller/auth/verify` - 署名検証
   - `/controller/sessions` - セッション作成（識別用）
   - `/controller/cardhosts` - 利用可能なcardhost一覧

3. **Controller WebSocket Handler** ([`controller-ws.ts`](../../packages/router/src/presentation/ws/controller-ws.ts))
   - `x-controller-id`と`x-session-token`の両方が必要
   - Controller認証チェック
   - セッション所有権チェック

## セッショントークンの役割

### 以前
```typescript
interface SessionData {
  sessionToken: string;
  bearerToken: string;  // 認証情報
  cardhostUuid?: string;
  expiresAt: Date;
}
```

### 現在
```typescript
interface SessionData {
  sessionToken: string;
  controllerId: string;  // 識別情報のみ
  cardhostUuid?: string; // 接続先の識別
  expiresAt: Date;
}
```

**セッショントークンは「識別」のためのみに使用:**
- どのcontrollerのセッションか
- どのcardhostへの接続か
- **認証ではない** - 認証は別途公開鍵で行う

## セキュリティの向上

### 以前の問題
1. Bearer tokenの漏洩リスク
2. トークンの再利用攻撃
3. 認証と識別が混在

### 現在の対策
1. **公開鍵暗号**: Ed25519署名による強力な認証
2. **チャレンジ-レスポンス**: リプレイ攻撃対策
3. **明確な分離**: 認証（誰か）と識別（何を）を分離
4. **セッション所有権**: セッションが正しいcontrollerに属するかチェック

## WebSocket接続要件

### Controller
```
Headers:
  x-controller-id: <controllerId>      # 認証済みcontroller
  x-session-token: <sessionToken>       # cardhost接続の識別

検証:
1. ControllerがID公開鍵で認証済みか
2. セッショントークンが有効か  
3. セッションがこのcontrollerに属するか
```

### Cardhost (変更なし)
```
Headers:
  x-cardhost-uuid: <uuid>

検証:
1. Cardhostが公開鍵で認証済みか
```

## マイグレーション

### Controller実装で必要な変更

**以前:**
```typescript
// Bearer token認証
const response = await fetch(`${router}/controller/connect`, {
  headers: { authorization: `Bearer ${token}` }
});
const { token: sessionToken } = await response.json();
```

**現在:**
```typescript
// 1. 認証開始
const { challenge } = await fetch(`${router}/controller/auth/initiate`, {
  method: 'POST',
  body: JSON.stringify({ controllerId, publicKey })
}).then(r => r.json());

// 2. チャレンジに署名
const signature = await signChallenge(challenge, privateKey);

// 3. 認証完了
await fetch(`${router}/controller/auth/verify`, {
  method: 'POST',
  body: JSON.stringify({ controllerId, challenge, signature })
});

// 4. セッション作成（cardhost接続用）
const { token: sessionToken } = await fetch(`${router}/controller/sessions`, {
  method: 'POST',
  body: JSON.stringify({ controllerId, cardhostUuid })
}).then(r => r.json());

// 5. WebSocket接続
const ws = new WebSocket(`${router}/ws/controller`, {
  headers: {
    'x-controller-id': controllerId,
    'x-session-token': sessionToken
  }
});
```

## 実装状況

✅ ControllerRepository実装
✅ ControllerAuthService実装
✅ SessionService更新（識別のみ）
✅ ControllerUseCase更新
✅ REST API更新
✅ WebSocketハンドラー更新
✅ Router統合
✅ ビルド成功

⏳ テスト更新（次のステップ）
⏳ ドキュメント更新

## 今後の拡張性

この設計により、以下が可能になります：

1. **複数セッション**: 1つのcontrollerが複数のcardhostに同時接続
2. **セッション委譲**: 認証済みcontrollerが他のcontrollerにセッションを委譲
3. **細かい権限管理**: 認証とセッション作成を分離したことで、権限をより細かく制御可能
4. **監査ログ**: 認証イベントとセッション作成イベントを別々に記録

## 参考資料

- Cardhostの認証実装: [`cardhost-auth.ts`](../../packages/router/src/service/auth-service.ts)
- Ed25519署名検証: Web Crypto API
- セッション管理: [`session-service.ts`](../../packages/router/src/service/session-service.ts)

---

**作成日**: 2025-12-09
**ステータス**: 実装完了、テスト更新待ち