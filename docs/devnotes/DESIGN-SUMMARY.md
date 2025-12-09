# WebSocketオンリーアーキテクチャ - 設計完了サマリー

**Date**: 2025-12-09  
**Status**: 🟢 設計完了・実装準備完了  
**Review Status**: ⏳ 実装開始前最終確認待ち  

---

## 📚 作成ドキュメント一覧

### 1. 統合アーキテクチャ設計
📄 [`INTEGRATED-WEBSOCKET-ARCHITECTURE-DESIGN.md`](./INTEGRATED-WEBSOCKET-ARCHITECTURE-DESIGN.md)

**内容**:
- ✅ 設計原則（HTTP完全廃止、接続=アイデンティティ、ステートフル通信）
- ✅ WebSocketフレームワーク基本設計
- ✅ メッセージプロトコル全定義
- ✅ Cardhost統合設計（Phase A）- 認証フロー、ファイル構成
- ✅ Controller統合設計（Phase B）- 認証フロー、ファイル構成
- ✅ Router統合設計（Phase C）- WebSocket処理流れ
- ✅ 全体アーキテクチャ図
- ✅ 4イテレーション実装計画（フレームワーク → 3モジュール）

**対象読者**: 全チーム  
**重要度**: 🔴 必読

---

### 2. WebSocketフレームワーク詳細仕様
📄 [`WEBSOCKET-FRAMEWORK-DETAILED-SPEC.md`](./WEBSOCKET-FRAMEWORK-DETAILED-SPEC.md)

**内容**:
- ✅ ファイル構成（6ファイル）
- ✅ `types.ts` - メッセージ型定義（詳細なTypeScript型）
- ✅ `context.ts` - WsContext実装（詳細コード）
- ✅ `message-router.ts` - ルーター実装（詳細コード）
- ✅ `ws-server.ts` - フレームワークコア（詳細コード＋ミドルウェア）
- ✅ Hono削除戦略（削除ファイル・置き換え実装）
- ✅ チェックリスト（実装・テスト・統合）

**対象読者**: 実装者（Phase 1-4）  
**重要度**: 🟡 詳細設計参考資料

---

### 3. 実装ロードマップ
📄 [`IMPLEMENTATION-ROADMAP.md`](./IMPLEMENTATION-ROADMAP.md)

**内容**:
- ✅ タイムラインサマリー（6-12時間推定）
- ✅ Phase 1: WebSocketフレームワーク基盤（2-3時間）
  - 5つの実装タスク詳細
  - テスト戦略（60テスト）
  - チェックリスト
- ✅ Phase 2: Cardhost全改修（2-3時間）
  - 3つの実装タスク詳細
  - テスト戦略（30テスト）
  - チェックリスト
- ✅ Phase 3: Controller全改修（2-3時間）
  - 3つの実装タスク詳細
  - テスト戦略（45テスト）
  - チェックリスト
- ✅ Phase 4: Router全改修（2-3時間）
  - 5つの実装タスク詳細
  - テスト戦略（65テスト）
  - チェックリスト
- ✅ 全体統合テスト（1-2時間）
- ✅ 並列実装戦略

**対象読者**: プロジェクトマネージャー、実装者  
**重要度**: 🟢 タイムライン・進行管理用

---

## 🎯 設計の核心

### 問題の本質
現在のアーキテクチャは **HTTP + WebSocket ハイブリッド** で複雑性が高い：
- 認証: HTTP REST API
- RPC: HTTP POST
- リアルタイム: WebSocket

→ **複数プロトコルの調停が必要** = バグの温床

### 解決策
**WebSocketオンリー** に統一 + **フレームワーク内部構築**

```
Before (現在):
  REST API (HTTP) ──┐
                    ├─ ビジネスロジック
  WebSocket ────────┤
                    ├─ 複雑なプロトコル切り替え
  複数の endpoint  ─┘
  複数の認証方式

After (改修後):
  WebSocket /ws/controller
  WebSocket /ws/cardhost     ──┐
                                ├─ ビジネスロジック
  WsServer フレームワーク    ──┤
  (Honoライク)                  ├─ 単一プロトコル
  MessageRouter               ──┤
  認証 → RPC 自動分離         ──┘
```

---

## 🏗️ WebSocketフレームワーク設計の工夫

### 1. Honoのようなfluent API

```typescript
// 設定例（pseudo code）
const ws = new WsServer()
  .use(loggingMiddleware)              // ロギング
  .use(rateLimitMiddleware)            // レート制限
  .use(timeoutMiddleware)              // タイムアウト
  .onAuth(handleAuthPhase)             // 認証フェーズ
  .onRpc(handleRpcPhase);              // RPC フェーズ

// 使用
ws.on("connection", (socket) => {
  await ws.handle(socket);
});
```

**利点**:
- 直感的・読みやすい
- 段階的な機能追加が容易
- テストしやすい

### 2. メッセージルーター（DispatcherPattern）

```typescript
const router = new MessageRouter()
  .register("auth-init", handleAuthInit)
  .register("auth-verify", handleAuthVerify)
  .register("error", handleError);

// メッセージ受信時
ws.on("message", async (data) => {
  const msg = JSON.parse(data);
  await router.route(ctx, msg);  // 型と対応ハンドラーで自動ルーティング
});
```

**利点**:
- メッセージハンドラーが明示的
- 新メッセージタイプの追加が簡単
- テストしやすい（ハンドラーの独立テスト）

### 3. 状態機械（State Machine Pattern）

```
CLOSED
  ↓ [WebSocket接続]
CONNECTING
  ↓ [auth-init送信]
AUTHENTICATING
  ↓ [署名検証完了]
AUTHENTICATED
  ↓ [Controller: connect-cardhost]
CONNECTED
  ↓
RPC_READY
  ↓ [close]
CLOSED
```

**利点**:
- フェーズ分離が明確
- 不正なメッセージ受信を防止
- デバッグが容易

### 4. 非同期待機（Promise-based）

```typescript
// メッセージタイプ別待機
const challenge = await ctx.waitForMessage("auth-challenge");

// メッセージID別待機（リクエスト/レスポンス相関）
const response = await ctx.waitForId("rpc_12345");
```

**利点**:
- 同期的に見えるコード（async/await）
- コールバック地獄を避ける
- タイムアウト処理が統一

---

## 📊 改修規模の可視化

### ファイル変更サマリー

| モジュール | 削除 | 新規 | 改修 | 合計 |
|-----------|------|------|------|------|
| **shared** | 0 | 6 | 1 | 7 |
| **cardhost** | 1-2 | 1 | 3 | 3-4 |
| **controller** | 1 | 1 | 3 | 3-4 |
| **router** | 2 | 5 | 3 | 8-10 |
| **全体** | **4-5** | **13-14** | **10** | **23-29** |

### テスト増加量

| フェーズ | ユニット | 統合 | E2E | 合計 |
|---------|----------|------|-----|------|
| Phase 1 | 60 | - | - | 60 |
| Phase 2 | 20 | 10 | - | 30 |
| Phase 3 | 30 | 15 | - | 45 |
| Phase 4 | 20 | 25 | 20 | 65 |
| **合計** | **130** | **50** | **20** | **200** |

---

## ⏰ 実装タイムラインの現実性

### 推定時間の根拠

| フェーズ | タスク数 | コード量 | テスト量 | 時間 |
|---------|--------|--------|--------|------|
| Phase 1 | 5 | ~600行 | ~800行 | 2-3h |
| Phase 2 | 3 | ~500行 | ~600行 | 2-3h |
| Phase 3 | 3 | ~500行 | ~750行 | 2-3h |
| Phase 4 | 5 | ~700行 | ~900行 | 2-3h |

**総コード量**: ~2,200行（フレームワーク含む）  
**総テスト量**: ~3,050行  
**総時間**: 8-12時間（順序に依存）

### ボトルネック

1. **Phase 1**: フレームワーク設計・テストが最重要
   - 他フェーズの品質に直結
   - 推定時間: 2-3時間（遅延リスク: 中）

2. **Phase 2-3**: 相互独立
   - 並列実装可能
   - 推定時間: 各2-3時間（遅延リスク: 低）

3. **Phase 4**: 最複雑
   - Router 中継ロジックが複雑
   - Cardhost/Controller との統合テスト必須
   - 推定時間: 2-3時間（遅延リスク: 高）

---

## ✅ 実装開始前チェックリスト

### 承認事項

- [ ] **設計方針の承認**
  - HTTP 完全廃止 → WebSocket オンリーに同意
  - 内部フレームワーク構築に同意

- [ ] **実装順序の確認**
  - 直列実装（Phase 1 → 2 → 3 → 4）を開始
  - または並列実装（2-3を同時）を開始？

- [ ] **Hono削除の承認**
  - Hono, @hono/node-server 削除に同意
  - node:http + ws で充分に同意

- [ ] **テスト厳密さの確認**
  - ユニットテスト: 各Module 80%+ カバレッジ
  - 統合テスト: 全フロー 100%
  - に同意

- [ ] **既存テストの処理確認**
  - 既存 REST API テスト → 削除 or 置き換え？
  - 既存 e2e テスト → 新フレームワーク対応?

---

## 🚀 次のステップ（実装開始）

### ステップ1: 最終確認（本ドキュメント）
- [ ] 3つの設計ドキュメントをレビュー
- [ ] 質問・修正事項があればフィードバック
- [ ] 承認事項にサイン

### ステップ2: Phase 1 実装開始
**切り替え**: Code モード → Phase 1 実装

```bash
# Phase 1 実装リスト
cd packages/shared/src/ws-framework
# Task 1.1: types.ts
# Task 1.2: context.ts
# Task 1.3: message-router.ts
# Task 1.4: ws-server.ts
# Task 1.5: index exports
# テスト作成・実行
```

### ステップ3: Phase 2-4 実装
**各フェーズ完了後**:
1. Code モードで実装
2. テスト実行・合格確認
3. 統合前レビュー

### ステップ4: 全体統合テスト
**全フェーズ完了後**:
1. E2E テスト実施
2. パフォーマンステスト
3. ドキュメント最終更新

---

## 📞 質問・確認事項

実装開始前に以下をご確認ください：

### Q1. 実装順序
- [ ] 直列実装（Phase 1 → 2 → 3 → 4）開始する？
- [ ] 並列実装（Phase 1完了後、2-3同時）開始する？

### Q2. Hono削除
- [ ] node:http のみで `/health`, `/stats` 実装で OK？
- [ ] 他に必要な HTTP 機能は？

### Q3. 既存テスト
- [ ] 既存 REST API テスト削除してもいい？
- [ ] 既存 e2e テストの扱いは？

### Q4. マイグレーション
- [ ] 旧 HTTP API は deprecate してもいい？
- [ ] 同時運用期間（HTTP + WebSocket）は不要？

### Q5. 追加要件
- [ ] 何か追加の設計要件はありますか？
- [ ] パフォーマンス目標はありますか？

---

## 🎉 設計完了！

このドキュメント群により、以下が完全に定義されました：

✅ **プロトコル**: メッセージ型・フロー完全定義  
✅ **フレームワーク**: 実装コード提供  
✅ **アーキテクチャ**: 3モジュール統合設計  
✅ **実装計画**: フェーズ別詳細ロードマップ  
✅ **テスト戦略**: 200+ テスト計画  

---

**設計者**: 🏗️ Architect Mode  
**最終更新**: 2025-12-09 16:30 UTC  
**次フェーズ**: 💻 Code Mode (実装開始)

---

## 📚 関連ドキュメント

- 📄 [`docs/what-to-make.md`](../../what-to-make.md) - プロジェクト仕様書（親ドキュメント）
- 📄 [`WEBSOCKET-ONLY-ARCHITECTURE-2025-12-09.md`](./WEBSOCKET-ONLY-ARCHITECTURE-2025-12-09.md) - 初期指示書
- 📄 [`INTEGRATED-WEBSOCKET-ARCHITECTURE-DESIGN.md`](./INTEGRATED-WEBSOCKET-ARCHITECTURE-DESIGN.md) - 統合設計
- 📄 [`WEBSOCKET-FRAMEWORK-DETAILED-SPEC.md`](./WEBSOCKET-FRAMEWORK-DETAILED-SPEC.md) - フレームワーク詳細
- 📄 [`IMPLEMENTATION-ROADMAP.md`](./IMPLEMENTATION-ROADMAP.md) - 実装ロードマップ
