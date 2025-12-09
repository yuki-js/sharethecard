# 実装ロードマップ - WebSocketオンリーアーキテクチャ

**Date**: 2025-12-09  
**Total Estimated Effort**: 8-10 hours (including tests)  
**Parallel Feasibility**: Phase 1 と Phase 2-4 は独立  

---

## 📊 タイムラインサマリー

```
Week 1:
├─ Day 1 (2-3h): Phase 1 - WebSocketフレームワーク基盤
├─ Day 2 (2-3h): Phase 2 - Cardhost全改修
├─ Day 3 (2-3h): Phase 3 - Controller全改修
└─ Day 4 (2-3h): Phase 4 - Router全改修

Total: 6-12 hours (テスト含む)
```

---

## 🎯 Phase 1: WebSocketフレームワーク基盤構築

**時間**: 2-3時間  
**依存**: なし  
**ブロック**: Phase 2-4  

### 1.1 ファイル作成

```
packages/shared/src/ws-framework/
├── types.ts                 [新規]
├── context.ts               [新規]
├── message-router.ts        [新規]
├── ws-server.ts             [新規]
└── middleware.ts            [新規]

packages/shared/src/index.ts [編集]
└── ws-framework の型/クラスをエクスポート

packages/shared/tests/ws-framework/
├── types.test.ts            [新規]
├── context.test.ts          [新規]
├── message-router.test.ts   [新規]
└── ws-server.test.ts        [新規]

packages/shared/package.json [編集]
└── 変更なし（既存依存で十分）
```

### 1.2 実装タスク

```
Task 1.1: types.ts - メッセージ型定義
─────────────────────────────────────
[ ] BaseMessage インターフェース
[ ] 認証メッセージ型（AuthInit, Challenge, Verify, Success）
[ ] Controller接続メッセージ型（ConnectCardhost, Connected）
[ ] RPCメッセージ型（Request, Response, Event）
[ ] エラー/制御メッセージ型
[ ] ユニオン型と状態型

タスク時間: 30分
テスト: N/A (型定義なのでコンパイルチェックのみ)
```

```
Task 1.2: context.ts - WsContext実装
────────────────────────────────────
[ ] WsContextImpl クラス実装
[ ] send() メソッド
[ ] sendError() メソッド
[ ] waitForMessage() 実装（タイムアウト付き）
[ ] waitForId() 実装
[ ] close() メソッド
[ ] isOpen() ヘルパー
[ ] メッセージリスナー管理

タスク時間: 45分
テスト: context.test.ts (送受信, 待機, タイムアウト)
```

```
Task 1.3: message-router.ts - メッセージルーター
─────────────────────────────────────────────
[ ] MessageRouter クラス実装
[ ] register() メソッド
[ ] route() メソッド（ハンドラー実行）
[ ] setDefault() メソッド
[ ] has() ヘルパー

タスク時間: 20分
テスト: message-router.test.ts (登録, ルーティング, 未登録処理)
```

```
Task 1.4: ws-server.ts - フレームワークコア
─────────────────────────────────────────
[ ] WsServer クラス実装
[ ] use() - ミドルウェア登録
[ ] onAuth() - 認証フェーズハンドラー
[ ] onRpc() - RPC フェーズハンドラー
[ ] handle() - メインエントリーポイント
[ ] executeMiddlewarePipeline() - パイプライン実行
[ ] WsMiddlewares ファクトリー（logging, rateLimit, timeout, heartbeat）

タスク時間: 45分
テスト: ws-server.test.ts (フェーズ分離, ミドルウェア, エラーハンドリング)
```

```
Task 1.5: Index export & shared package.json
─────────────────────────────────────────
[ ] packages/shared/src/index.ts に ws-framework エクスポート
[ ] packages/shared/src/ws-framework/index.ts 作成
[ ] export {
      WsServer,
      WsContextImpl,
      MessageRouter,
      WsMiddlewares,
      type WsContext,
      type Message,
      type WsHandler,
      type WsMiddleware,
      ...all message types
    }

タスク時間: 10分
```

### 1.3 テスト戦略

```
Unit Tests (4 files, ~60 tests total)
─────────────────────────────────────

context.test.ts (15 tests)
  ✓ send() - 成功, ネットワークエラー, 閉鎖済み接続
  ✓ waitForMessage() - 正常, タイムアウト, 複数メッセージ
  ✓ waitForId() - 正常, タイムアウト
  ✓ close() - 正常, 既に閉じられている

message-router.test.ts (12 tests)
  ✓ register() - 単一登録, 複数登録
  ✓ route() - 登録ハンドラー実行, 未登録メッセージ
  ✓ setDefault() - デフォルトハンドラー
  ✓ has() - 存在確認

ws-server.test.ts (20 tests)
  ✓ handle() - フェーズ分離 (auth → rpc)
  ✓ use() - ミドルウェアチェーン
  ✓ onAuth() & onRpc() - ハンドラー登録と実行
  ✓ エラーハンドリング
  ✓ ミドルウェア (logging, timeout, heartbeat)

types.test.ts (13 tests)
  ✓ メッセージ型の型安全性（TypeScript compile check）
  ✓ ユニオン型の網羅
  ✓ 型ガード

Total: ~60 tests, Coverage: 85%+ 目標
```

### 1.4 チェックリスト

```
実装
─────
[ ] types.ts - すべての型定義
[ ] context.ts - WsContext 完全実装
[ ] message-router.ts - MessageRouter 完全実装
[ ] ws-server.ts - WsServer + ミドルウェア
[ ] exports

テスト
─────
[ ] context.test.ts 作成・合格
[ ] message-router.test.ts 作成・合格
[ ] ws-server.test.ts 作成・合格
[ ] 全テスト 実行・合格
[ ] カバレッジ 85%+ 確認

統合確認
─────
[ ] npm test 全合格
[ ] ビルド成功
[ ] yarn lint 成功
```

---

## 🚀 Phase 2: Cardhost全改修

**時間**: 2-3時間  
**依存**: Phase 1 完了  
**ブロック**: Phase 4 (Router)  

### 2.1 ファイル構成

```
改修ファイル:
├── packages/cardhost/src/lib/
│   ├── router-transport.ts    [✏️ 大改修 - HTTP削除, WS認証統合]
│   ├── cardhost-service.ts    [✏️ 簡略化]
│   ├── auth-manager.ts        [❌ 削除 or ✏️ utility化]
│   └── config-manager.ts      [変更なし]
│
├── packages/cardhost/src/runtime/
│   └── main.ts                [変更なし]
│
└── packages/cardhost/tests/
    ├── router-transport.test.ts [新規 - WebSocket認証テスト]
    └── e2e-cardhost.test.ts     [新規 - E2E テスト]
```

### 2.2 実装タスク

```
Task 2.1: auth-manager.ts の処理を router-transport.ts に統合
────────────────────────────────────────────────────────
[ ] 既存 auth-manager.ts を auth-utils.ts に rename（ユーティリティのみ保持）
    - verifyDerivedUuid()
    - signChallenge()

[ ] router-transport.ts に認証ロジック統合
    - private authenticate() メソッド
    - private handleAuthMessage() メソッド
    - WebSocket メッセージリスナー

タスク時間: 45分
```

```
Task 2.2: router-transport.ts 完全書き直し
────────────────────────────────────────
認証フェーズ:
[ ] WebSocket接続 (/ws/cardhost)
[ ] auth-init メッセージ送信（publicKey）
[ ] auth-challenge 受信・検証
[ ] auth-verify メッセージ送信（signature）
[ ] auth-success 確認

RPC フェーズ:
[ ] onRequest() ハンドラー登録（変更なし）
[ ] emitEvent() 実装（RPC イベント返送）
[ ] start() - 接続・認証完了までのフロー
[ ] stop() - クリーンアップ
[ ] isConnected() チェック

フレームワーク活用:
[ ] WsServer / MessageRouter を活用
[ ] 状態管理（authenticated, uuid）
[ ] タイムアウト処理

タスク時間: 1時間
```

```
Task 2.3: cardhost-service.ts の簡略化
───────────────────────────────────────
[ ] 認証フロー簡略化（auth-manager 削除）
    - authManager への依存削除
    - 認証は router-transport 内部で実行

[ ] connect() フロー
    - config ロード
    - transport 作成
    - adapter.start() で接続・認証自動実行
    - UUID を config に保存

[ ] disconnect() - 変更なし

タスク時間: 30分
```

### 2.3 テスト戦略

```
Unit Tests
─────────

router-transport.test.ts (20 tests)
  ✓ start() - 接続成功, 接続失敗
  ✓ authenticate() - auth-init→challenge→verify→success フロー
  ✓ UUID 検証 - 正常, 不正
  ✓ RPC メッセージハンドリング
  ✓ stop() - クリーンアップ

Integration Tests
─────────────────

cardhost-mock-router.test.ts (10 tests)
  ✓ Mock Router との通信テスト
  ✓ 完全な認証フロー
  ✓ RPC リクエスト/レスポンス

Total: ~30 tests, Coverage: 80%+
```

### 2.4 チェックリスト

```
実装
─────
[ ] auth-manager.ts → auth-utils.ts rename
[ ] router-transport.ts 完全書き直し
[ ] cardhost-service.ts 簡略化

テスト
─────
[ ] router-transport.test.ts 作成・合格
[ ] cardhost-mock-router.test.ts 作成・合格
[ ] 既存テスト互換性確認

統合確認
─────
[ ] 単体テスト 全合格
[ ] ビルド成功
[ ] lint 成功
```

---

## 🎮 Phase 3: Controller全改修

**時間**: 2-3時間  
**依存**: Phase 1 完了  
**ブロック**: Phase 4 (Router)  

### 3.1 ファイル構成

```
改修ファイル:
├── packages/controller/src/lib/
│   ├── router-transport.ts    [✏️ 大改修 - HTTP削除, WS通信統合]
│   ├── session-manager.ts     [✏️ WebSocket認証統合]
│   ├── controller-client.ts   [✏️ 簡略化]
│   ├── key-manager.ts         [変更なし]
│   └── commands/              [変更確認]
│
└── packages/controller/tests/
    ├── router-transport.test.ts [新規]
    ├── session-manager.test.ts  [新規]
    └── e2e-controller.test.ts   [新規]
```

### 3.2 実装タスク

```
Task 3.1: session-manager.ts を WebSocket認証に改修
─────────────────────────────────────────────
[ ] authenticate() メソッド書き直し
    - WebSocket 接続 (/ws/controller)
    - auth-init メッセージ送信
    - auth-challenge 受信・ID検証
    - auth-verify メッセージ送信
    - auth-success 確認

[ ] listCardhosts() - WebSocket 削除，API削除
    - 注: Router からの push 待機？ 
    - 暫定: HTTP GET /cardhost-list 廃止，Router 統合で提供

[ ] createSession() - WebSocket 削除
    - Controller auth 後に Router にメッセージ送信

タスク時間: 45分
```

```
Task 3.2: router-transport.ts - WebSocket RPC統合
──────────────────────────────────────────────
認証フェーズ（SessionManager から引き継ぎ）:
[ ] connect() で WebSocket 接続・認証
    - SessionManager.authenticate() 呼び出し
    - Router 派生 controller-id 取得

接続フェーズ:
[ ] connectToCardhost() 実装
    - connect-cardhost メッセージ送信
    - connected メッセージ待機

RPC フェーズ:
[ ] call() - RPC 要求送信（ClientTransport interface）
    - rpc-request メッセージ送信（id付き）
    - 対応する rpc-response 待機
    - レスポンス返送

[ ] onEvent() - イベントリスナー（オプション）

[ ] close() - クリーンアップ

フレームワーク活用:
[ ] WsServer / MessageRouter を活用
[ ] 状態管理（authenticated, connected, pendingCalls）
[ ] タイムアウト処理

タスク時間: 1時間
```

```
Task 3.3: controller-client.ts の簡略化
───────────────────────────────────────
[ ] connect() フロー簡略化
    - SessionManager.authenticate() + createSession()
    - RouterClientTransport 作成（接続・認証自動）
    - RemoteSmartCardPlatform.init()

[ ] listCardhosts() - 削除 or 保持確認

[ ] disconnect() - 変更なし

タスク時間: 30分
```

### 3.3 テスト戦略

```
Unit Tests
─────────

session-manager.test.ts (15 tests)
  ✓ authenticate() - WebSocket フロー
  ✓ Controller ID 検証
  ✓ listCardhosts() - 新実装確認
  ✓ createSession() - WebSocket 実装

router-transport.test.ts (15 tests)
  ✓ connect() → connectToCardhost() フロー
  ✓ call() - RPC 送受信
  ✓ タイムアウト処理
  ✓ close()

Integration Tests
─────────────────

controller-mock-router.test.ts (15 tests)
  ✓ 完全な認証フロー
  ✓ Cardhost 接続フロー
  ✓ RPC リクエスト/レスポンス
  ✓ エラーハンドリング

Total: ~45 tests, Coverage: 80%+
```

### 3.4 チェックリスト

```
実装
─────
[ ] session-manager.ts 書き直し
[ ] router-transport.ts 完全改修
[ ] controller-client.ts 簡略化
[ ] commands/* 互換性確認

テスト
─────
[ ] session-manager.test.ts 作成・合格
[ ] router-transport.test.ts 作成・合格
[ ] e2e-controller.test.ts 作成・合格

統合確認
─────
[ ] 単体テスト 全合格
[ ] ビルド成功
[ ] lint 成功
```

---

## 🔄 Phase 4: Router全改修

**時間**: 2-3時間  
**依存**: Phase 1, 2, 3 完了  

### 4.1 ファイル構成

```
削除ファイル:
├── packages/router/src/presentation/rest/
│   ├── controller-routes.ts  [❌ DELETE]
│   └── cardhost-routes.ts    [❌ DELETE]

改修ファイル:
├── packages/router/src/
│   ├── server.ts             [✏️ Hono削除, WebSocket統合]
│   ├── router.ts             [変更なし]
│
├── packages/router/src/presentation/ws/
│   ├── controller-ws.ts      [✏️ 完全書き直し - フレームワーク活用]
│   ├── cardhost-ws.ts        [✏️ 完全書き直し - フレームワーク活用]
│   └── handlers/             [新規]
│       ├── controller-auth.ts [新規 - ハンドラー関数]
│       ├── controller-rpc.ts  [新規]
│       ├── cardhost-auth.ts   [新規]
│       └── cardhost-rpc.ts    [新規]
│
├── packages/router/src/presentation/http/
│   ├── health.ts             [新規 - シンプル実装]
│   └── stats.ts              [新規]

新規テスト:
└── packages/router/tests/
    ├── ws-controller.test.ts  [新規 - Cardhost と通信]
    ├── ws-cardhost.test.ts    [新規 - Controller と通信]
    └── full-integration.test.ts [新規]
```

### 4.2 実装タスク

```
Task 4.1: REST routes 削除 & Hono削除
─────────────────────────────────────
[ ] packages/router/src/presentation/rest/ 削除
[ ] packages/router/package.json
    - dependencies から hono, @hono/node-server 削除
    - ws, node:http 確認
[ ] server.ts から REST routes import削除

タスク時間: 15分
```

```
Task 4.2: server.ts 書き直し（Hono削除）
───────────────────────────────────────
[ ] import { createServer } from "node:http"
[ ] import { WebSocketServer } from "ws"

[ ] シンプルなHTTPサーバー実装
    - /health → JSON レスポンス
    - /stats → JSON レスポンス
    - その他 → 404

[ ] WebSocketServer マウント
    - /ws/controller → handleControllerWs()
    - /ws/cardhost → handleCardhostWs()

[ ] ポート設定, ホスト設定

[ ] graceful shutdown

タスク時間: 30分
```

```
Task 4.3: ハンドラー関数の新規作成
─────────────────────────────────
packages/router/src/presentation/ws/handlers/

controller-auth.ts
[ ] handleControllerAuthInit() - auth-init 受信
[ ] handleControllerAuthVerify() - auth-verify 受信

controller-rpc.ts
[ ] handleConnectCardhost() - connect-cardhost 受信
[ ] handleRpcRequest() - rpc-request 受信・中継

cardhost-auth.ts
[ ] handleCardhostAuthInit() - auth-init 受信
[ ] handleCardhostAuthVerify() - auth-verify 受信

cardhost-rpc.ts
[ ] handleRpcRequest() - rpc-request 受信（Controller から中継）

タスク時間: 45分
```

```
Task 4.4: controller-ws.ts & cardhost-ws.ts 書き直し
──────────────────────────────────────────────
controller-ws.ts
[ ] WsServer インスタンス作成
[ ] onAuth() - 認証フェーズハンドラー
    - MessageRouter で auth-init/verify ルーティング
    - ハンドラー関数呼び出し
[ ] onRpc() - RPC フェーズハンドラー
    - MessageRouter で connect-cardhost/rpc-request ルーティング
    - ハンドラー関数呼び出し
[ ] handle(ws) をエクスポート

cardhost-ws.ts
[ ] WsServer インスタンス作成
[ ] onAuth() - 認証フェーズハンドラー
[ ] onRpc() - RPC フェーズハンドラー
[ ] handle(ws) をエクスポート

タスク時間: 45分
```

```
Task 4.5: HTTP ハンドラー実装
────────────────────────────
health.ts
[ ] /health エンドポイント
[ ] router.isRunning() チェック

stats.ts
[ ] /stats エンドポイント
[ ] router.getStats() 返送

タスク時間: 15分
```

### 4.3 テスト戦略

```
Unit Tests
─────────

ws-handlers.test.ts (20 tests)
  ✓ Controller auth ハンドラー
  ✓ Cardhost auth ハンドラー
  ✓ RPC ハンドラー
  ✓ エラーハンドリング

Integration Tests
─────────────────

ws-integration.test.ts (25 tests)
  ✓ Controller 認証フロー (Mock)
  ✓ Cardhost 認証フロー (Mock)
  ✓ Controller → Router → Cardhost の中継
  ✓ エラーケース

full-system.test.ts (20 tests)
  ✓ 実際の Router サーバー起動
  ✓ Controller/Cardhost Mock 接続
  ✓ APDU コマンド送受信
  ✓ ハートビート, タイムアウト

Total: ~65 tests, Coverage: 85%+
```

### 4.4 チェックリスト

```
実装
─────
[ ] REST routes 削除
[ ] server.ts 書き直し
[ ] controller-ws.ts 完全書き直し
[ ] cardhost-ws.ts 完全書き直し
[ ] ハンドラー関数群作成
[ ] HTTP handlers 実装
[ ] package.json 更新

テスト
─────
[ ] ws-handlers.test.ts 作成・合格
[ ] ws-integration.test.ts 作成・合格
[ ] full-system.test.ts 作成・合格

統合確認
─────
[ ] 単体テスト 全合格
[ ] ビルド成功
[ ] lint 成功
[ ] HTTP /health, /stats 確認
```

---

## 🧪 全体統合テスト

**時間**: 1-2時間  
**依存**: Phase 1-4 完了  

### テストシナリオ

```
Scenario 1: Cardhost → Router 認証
──────────────────────────────────
1. Start Router
2. Cardhost connects /ws/cardhost
3. Cardhost sends auth-init
4. Router sends auth-challenge
5. Cardhost sends auth-verify
6. Router sends auth-success
✓ Cardhost.uuid = Router-derived UUID
```

```
Scenario 2: Controller → Router 認証
────────────────────────────────────
1. Start Router
2. Cardhost connects & authenticates (Scenario 1)
3. Controller connects /ws/controller
4. Controller sends auth-init
5. Router sends auth-challenge
6. Controller sends auth-verify
7. Router sends auth-success
✓ Controller.controllerId = Router-derived ID
```

```
Scenario 3: Controller → Router → Cardhost (完全フロー)
────────────────────────────────────────────────────
1. Cardhost connected & authenticated
2. Controller connected & authenticated
3. Controller sends connect-cardhost (cardhostUuid)
4. Router creates session
5. Router sends connected to Controller
6. Controller sends rpc-request (APDU command)
7. Router relays to Cardhost
8. Cardhost processes RPC
9. Cardhost sends rpc-response
10. Router relays to Controller
11. Controller receives response
✓ APDU send/receive 成功
```

```
Scenario 4: エラーハンドリング
──────────────────────────────
- 不正な公開鍵
- 署名検証失敗
- タイムアウト
- Cardhost 接続なし時の connect-cardhost
- 無効な RPC メッセージ
✓ すべてのエラーが適切に処理される
```

### テストファイル

```
tests/integration/full-flow.test.ts (30+ tests)
  ✓ Cardhost 認証テスト
  ✓ Controller 認証テスト
  ✓ 完全フロー
  ✓ エラーハンドリング
  ✓ 同時接続テスト
  ✓ リコネクション
  ✓ セッションタイムアウト
```

---

## 📋 全体チェックリスト

### Phase 1: WebSocketフレームワーク
- [ ] types.ts 実装
- [ ] context.ts 実装
- [ ] message-router.ts 実装
- [ ] ws-server.ts 実装
- [ ] Framework tests 全合格

### Phase 2: Cardhost
- [ ] auth-manager.ts → auth-utils.ts
- [ ] router-transport.ts 完全書き直し
- [ ] cardhost-service.ts 簡略化
- [ ] Cardhost tests 全合格

### Phase 3: Controller
- [ ] session-manager.ts 書き直し
- [ ] router-transport.ts 改修
- [ ] controller-client.ts 簡略化
- [ ] Controller tests 全合格

### Phase 4: Router
- [ ] REST routes 削除
- [ ] server.ts 書き直し
- [ ] controller-ws.ts & cardhost-ws.ts 書き直し
- [ ] ハンドラー関数群実装
- [ ] Router tests 全合格

### 統合
- [ ] 全体 unit tests 合格
- [ ] 全体 integration tests 合格
- [ ] ビルド成功
- [ ] lint 成功
- [ ] ドキュメント更新

---

## 🚀 並列実装戦略

### 完全直列（推奨）
```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → 統合テスト

利点: 依存関係明確, テストしやすい
時間: 8-10時間
```

### 準並列（チーム複数人の場合）
```
Phase 1 を完了 → Phase 2 & 3 を並列 → Phase 4
  ↑
完了時にマージ

利点: Phase 2 & 3 は独立
難点: マージ複雑性
```

---

**次ステップ**: 
1. このロードマップをレビュー
2. Phase 1 実装開始（Code モードに切り替え）
3. 各フェーズ完了後にレビュー・統合

---

## 📞 質問・確認事項

以下の点でご確認ください：

1. **実装順序**: 直列/並列 どちらの進め方を希望しますか？
2. **テスト厳密さ**: カバレッジ目標は 80% or 85%+?
3. **既存テスト**: 既存の E2E テストは削除/維持？
4. **マイグレーション計画**: 旧 HTTP API からの段階的移行?
5. **Hono 削除**: 完全削除で問題ないですか？（HTTPサーバーは node:http で十分？）

---

**推定時間**:
- Phase 1: 2-3h
- Phase 2: 2-3h
- Phase 3: 2-3h
- Phase 4: 2-3h
- 統合テスト: 1-2h
- **合計: 8-14 hours** (テスト・デバッグ含む)
