# プロジェクト仕様書：Remote APDU Communication System

## 1. プロジェクト概要

### 1.1 目的

[`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip) ライブラリを活用した、サーバーを介したリモートAPDU送受信システムの構築。

### 1.2 コアコンセプト

- 異なる所有者が管理する3つのコンポーネント（Controller、Cardhost、Router）の連携
- NAT環境下でも動作可能なアウトバウンド接続ベースの設計
- [`jsapdu`](https://github.com/AokiApp/jsapdu-over-ip) インターフェースを通じたシームレスなAPDU通信
- エンドツーエンド暗号化による安全な通信

---

## 2. システムアーキテクチャ

### 2.1 全体構成図（概念図）

```
[Controller]  ←→  [Router]  ←→  [Cardhost]
   (Browser)         (Server)        (Card Reader)
      ↓                               ↓
   GUI操作                         物理カード

通信フロー:
1. Controller → Router: Outbound接続（REST/WebSocket）
2. Cardhost → Router: Outbound接続（REST/WebSocket）
3. Controller ←→ Cardhost: Router経由の仮想ネットワーク（E2E暗号化）
```

### 2.2 所有者モデル

- **Controller**: APDU操作を要求する利用者が所有
- **Cardhost**: カードリーダーとカードを保持する提供者が所有
- **Router**: 中継インフラストラクチャを提供するサービス運営者が所有

---

## 3. コンポーネント詳細仕様

### 3.1 Controller（コントローラー）

#### 3.1.1 概要

カードへのAPDUコマンド送信を行うコマンドラインツール（CLI）。対話型コマンドとスクリプト実行の両方に対応。

#### 3.1.2 技術スタック

- **言語**: TypeScript
- **実行環境**: Node.js
- **CLI フレームワーク**: Commander.js または Yargs（推奨）
- **必須ライブラリ**: [`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip)

#### 3.1.3 主要機能

1. **接続管理**
   - Router へのアウトバウンド接続（WebSocket/REST）
   - Cardhost UUID を指定した接続確立
   - NAT トラバーサル対応（アウトバウンド接続のみ使用）
   - 接続状態の自動再接続

2. **APDU操作**
   - [`jsapdu`](https://github.com/AokiApp/jsapdu-over-ip) インターフェースを通じたリモートカード操作
   - 低レベルAPDUコマンドの直接送信
   - 16進数表記でのコマンド入力/レスポンス出力
   - レスポンスのSW（Status Word）解析

3. **コマンドラインインターフェース（CUI）**
   - 対話型モード（REPL）による連続操作
   - 単発コマンド実行モード
   - スクリプトファイルからのバッチ実行
   - APDU コマンド履歴の保存と再実行
   - 標準出力/エラー出力への適切な出力
   - カラー表示によるステータス可視化（オプション）
   - 詳細ログモード（-v, --verbose フラグ）

4. **スクリプト対応**
   - JSON/YAML形式のコマンドスクリプト読み込み
   - パイプ処理対応（標準入力からのコマンド受付）
   - 標準出力への結果出力（他ツールとの連携）

#### 3.1.4 CLIコマンド例

```bash
# 接続
$ controller connect --router https://router.example.com --cardhost <UUID> --token <TOKEN>

# 単発APDUコマンド送信
$ controller send --apdu "00A4040008A000000003000000"

# 対話型モード起動
$ controller interactive --router https://router.example.com --cardhost <UUID>
> send 00A4040008A000000003000000
< 9000
> send 00B0000000
< 6C20
> exit

# スクリプト実行
$ controller script --file commands.json
$ cat commands.txt | controller batch

# Cardhost一覧取得
$ controller list --router https://router.example.com

# 詳細ログモード
$ controller send --apdu "00A4..." --verbose
```

#### 3.1.5 認証方式

- ベアラー認証（以下のいずれかを実装）
  - ベアラートークン（環境変数または設定ファイルから読み込み）
  - 公開鍵/秘密鍵ペア（~/.controller/id_ed25519 等）
  - チャレンジ-レスポンス認証

#### 3.1.6 セキュリティ要件

- Router との通信は TLS で保護
- Cardhost とのエンドツーエンド暗号化（詳細は「5. セキュリティ設計」を参照）
- 認証情報の安全な保管（設定ファイルのパーミッション制限）

---

### 3.2 Cardhost（カードホスト）

#### 3.2.1 概要

物理的なカードリーダーとカードを管理し、Controller からのリモート操作要求を実カードへのAPDUコマンドに変換するアプリケーション。

#### 3.2.2 技術スタック

- **言語**: TypeScript
- **実行環境**: Node.js
- **必須ライブラリ**: [`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip)

#### 3.2.3 主要機能

1. **接続管理**
   - Router へのアウトバウンド接続（WebSocket/REST）
   - 固有UUID による識別（128ビット）
   - UUID の永続化と再接続時の維持
   - NAT トラバーサル対応

2. **カード操作**
   - [`jsapdu`](https://github.com/AokiApp/jsapdu-over-ip) インスタンスの管理
   - Controller からのリモート操作を物理カード操作に変換
   - カード挿入/取り外し検知
   - APDU コマンドの実行とレスポンス返送

3. **UUID管理**
   - 128ビット UUID の生成と永続化
   - 再起動・再接続時の同一性保証
   - **注意**: 128ビットは長期トラッキングには不十分な可能性に留意

#### 3.2.4 認証方式

- 固定鍵ペア（公開鍵/秘密鍵）による認証
- ピア同定と認証を鍵ペアで実現

#### 3.2.5 セキュリティ要件

- 秘密鍵の安全な保管
- Router との通信は TLS で保護
- Controller とのエンドツーエンド暗号化

---

### 3.3 Router（ルーター）

#### 3.3.1 概要

Controller と Cardhost をインターネット越しに接続する中継サーバー。

#### 3.3.2 技術スタック

- **言語**: TypeScript
- **フレームワーク**: Hono
- **実行環境**: Node.js / Cloudflare Workers / Deno（環境に応じて）

#### 3.3.3 主要機能

1. **接続管理**
   - Controller からのインバウンド接続受付（REST/WebSocket）
   - Cardhost からのインバウンド接続受付（REST/WebSocket）
   - セッション管理とルーティング

2. **認証・認可**
   - Controller: ベアラートークン検証
   - Cardhost: 公開鍵認証
   - アクセス制御とパーミッション管理

3. **通信中継**
   - Controller と Cardhost 間の仮想ネットワーク構築
   - E2E暗号化されたペイロードの中継（復号化なし）
   - セッションキー交換の仲介

4. **モニタリング**
   - 接続状態の監視
   - メトリクス収集
   - ログ記録

#### 3.3.4 プロトコル設計

- **REST API**: 接続確立、認証、メタデータ操作
- **WebSocket**: リアルタイム通信、APDU送受信、イベント通知

#### 3.3.5 セキュリティ要件

- TLS/HTTPS 必須
- 認証情報の安全な管理
- DDoS対策とレート制限
- ログの適切な管理（機密情報の除外）

---

### 3.4 Cardhost-Monitor（カードホストモニター）

#### 3.4.1 概要

Cardhost と同じプロセスで動作し、Cardhost 所有者向けの監視用 Web UI。

#### 3.4.2 技術スタック

- **言語**: TypeScript
- **フレームワーク**: 軽量な Web フレームワーク（Express等）
- **UI**: シンプルな HTML/CSS/JS または軽量フレームワーク

#### 3.4.3 主要機能

1. **稼働状況監視**
   - Cardhost の動作状態（起動中/停止中/エラー）
   - Router への接続状態
   - アクティブなセッション数

2. **メトリクス表示**
   - APDU 送受信数
   - エラー発生率
   - レスポンスタイム統計
   - セッション履歴

3. **ログ閲覧**
   - リアルタイムログストリーム
   - エラーログのフィルタリング
   - デバッグ情報

4. **テレメトリ**
   - CPU/メモリ使用率
   - ネットワーク使用量
   - カード接続状態

#### 3.4.4 アクセス制御

- ローカルホストのみからアクセス可能（デフォルト）
- オプション: パスワード認証

### 3.5. 共通項

- cardhost, router, controllerは通常はスタンドアローンで動作する
- テストランナーで動作できるように、ライブラリとしても提供される
- ライブラリに対して、ランタイムという下駄を履かせる形にしてスタンドアローンで動作するようになる。

> **注意**: 現状このようになっていない実装があるから注意すること。

---

## 4. 通信プロトコル詳細

### 4.1 Cardhost ↔ Router

#### 4.1.1 認証フロー

1. Cardhost が公開鍵を含む接続要求を送信
2. Router がチャレンジを発行
3. Cardhost が秘密鍵で署名したレスポンスを返送
4. Router が署名を検証して認証完了

#### 4.1.2 通信パターン

- **初期接続**: REST API（POST /cardhost/connect）
- **ハートビート**: WebSocket（定期的な生存確認、署名付き）
- **APDU中継**: WebSocket（暗号化されたペイロード転送）
- **イベント通知**: WebSocket（カード挿入/取り外し等）

### 4.2 Controller ↔ Router

#### 4.2.1 認証フロー

1. Controller がベアラートークンを含む接続要求を送信
2. Router がトークンを検証
3. 認証成功後、セッショントークンを発行
4. WebSocket アップグレード時にセッショントークンを使用

#### 4.2.2 通信パターン

- **初期接続**: REST API（POST /controller/connect）
- **Cardhost 検索**: REST API（GET /cardhosts）
- **セッション確立**: REST API（POST /sessions）
- **APDU送受信**: WebSocket（暗号化されたペイロード転送）

### 4.3 Controller ↔ Cardhost（E2E）

#### 4.3.1 暗号化プロトコル

Router を信頼せずにエンドツーエンドで暗号化された通信を実現。

**キー交換プロトコル**:

1. **鍵交換**: ECDH（Elliptic Curve Diffie-Hellman）
   - Router が両者の公開鍵を仲介
   - Router は認証のみを担当（復号化不可）
2. **セッション鍵生成**: ECDH共有秘密から導出
   - HKDF（HMAC-based Key Derivation Function）使用
3. **データ暗号化**: AES-256-GCM
   - 認証付き暗号化（AEAD）
   - メッセージ認証コード（MAC）による改ざん検知

#### 4.3.2 メッセージフォーマット

```typescript
interface EncryptedMessage {
  iv: string; // 初期化ベクトル (Base64)
  ciphertext: string; // 暗号化データ (Base64)
  authTag: string; // 認証タグ (Base64)
  senderPublicKey: string; // 送信者の公開鍵 (Base64)
}
```

#### 4.3.3 署名と検証

- **署名アルゴリズム**: EdDSA (Ed25519) または ECDSA (P-256)
- **署名対象**: 重要なメッセージ（接続確立、APDU、ハートビート）
- **検証**: 全ての受信メッセージで署名検証を実施

---

## 5. セキュリティ設計

### 5.1 暗号化アルゴリズム

#### 5.1.1 推奨アルゴリズム

- **公開鍵暗号**: 楕円曲線暗号（ECDSA/EdDSA）
  - 理由: 署名検証が高速、サーバー検証が多い環境に適している
  - 曲線: Ed25519 または P-256
- **鍵交換**: ECDH（Ephemeral）
  - Perfect Forward Secrecy（PFS）を実現
- **共通鍵暗号**: AES-256-GCM
  - 認証付き暗号化による改ざん検知
- **ハッシュ関数**: SHA-256 または SHA-3

#### 5.1.2 鍵管理

- **Cardhost**: 永続的な鍵ペア（デバイス認証用）
- **セッション鍵**: ECDH で生成、セッション終了時に破棄
- **鍵のローテーション**: 定期的なセッション鍵更新

### 5.2 認証・認可

#### 5.2.1 Cardhost 認証

```
方式: 公開鍵認証 + チャレンジ-レスポンス

フロー:
1. Cardhost → Router: 公開鍵 + UUID
2. Router → Cardhost: チャレンジ（ランダムナンス）
3. Cardhost → Router: Sign(PrivateKey, Challenge)
4. Router: Verify(PublicKey, Challenge, Signature)
```

#### 5.2.2 Controller 認証

```
方式: ベアラートークン（JWT または独自トークン）

フロー:
1. Controller → Router: Bearer Token
2. Router: Token検証（署名確認、有効期限確認）
3. Router → Controller: Session Token
4. WebSocket接続時: Session Token使用
```

### 5.3 メッセージ認証

全ての重要なメッセージに署名を付与：

- 接続確立メッセージ
- APDU コマンド/レスポンス
- ハートビート
- セッション制御メッセージ

#### 5.3.1 メッセージ認証の実装方式

**原則**: デジタル署名（EdDSA/ECDSA）を使用

全てのメッセージ認証は原則としてデジタル署名で実装する。各メッセージに対して EdDSA (Ed25519) または ECDSA (P-256) による署名を付与し、受信側で検証を行う。

**例外**: HMAC の限定的使用

以下の条件を**両方満たす場合に限り**、HMACの使用を許可：

1. **技術的必然性**: HMACでしか実現できない要件がある場合
   - 例: 極めて高頻度な通信でデジタル署名の計算コストが実測で問題となる場合
   - 例: 特定の制約された環境で公開鍵暗号の実装が利用できない場合

2. **性能的優位性**: HMACが圧倒的に効率が良いことが実測で証明された場合
   - 単なる理論値ではなく、実際のベンチマーク結果に基づく判断
   - "圧倒的"とは、少なくとも10倍以上の性能差がある場合

**HMAC使用時の要件**:

- 使用理由をコメントで明記すること
- セッション鍵ベースのMAC（HMAC-SHA256以上）を使用
- 可能な限りデジタル署名への移行を検討すること

### 5.4 攻撃対策

#### 5.4.1 リプレイ攻撃対策

- タイムスタンプとナンスの組み合わせ
- シーケンス番号の使用

#### 5.4.2 中間者攻撃対策

- E2E暗号化（Router による復号不可）
- 公開鍵のピンニングまたは証明書検証

#### 5.4.3 サービス拒否攻撃対策

- レート制限
- タイムアウト設定
- 接続数制限

---

## 6. テスト戦略

### 6.1 テストフレームワーク

**必須**: Vitest

- `vi.mock` の使用が奨励される

### 6.2 テストレベルと責務

#### 6.2.1 ユニットテスト

**目的**: 各モジュール・コンポーネントが単体で正しく動作することを保証

**対象例**:

- 暗号化/復号化関数
- メッセージパーサー
- 認証ロジック
- UUID生成・検証
- セッション管理クラス

**要件**:

- 各モジュールごとに専用のテストファイルを作成
- 正常系、準正常系、異常系の網羅
- エッジケース（境界値、空入力、不正入力）のテスト
- モックの適切な使用

**テストファイル配置例**:

```
src/
  crypto/
    encryption.ts
    encryption.test.ts    ← ユニットテスト
  auth/
    bearer.ts
    bearer.test.ts        ← ユニットテスト
```

#### 6.2.2 結合テスト（Integration Test）

**目的**: 複数のコンポーネントが連携して正しく動作することを確認

**対象例**:

- Controller の通信レイヤーとビジネスロジックの連携
- Cardhost の [`jsapdu`](https://github.com/AokiApp/jsapdu-over-ip) ラッパーとネットワーク層の統合
- Router の認証ミドルウェアとルーティングの連携

**要件**:

- 実際の依存関係を使用（必要に応じてモック）
- データフローの検証
- エラーハンドリングの確認
- Node プロセスの spawn は原則不要（コメントで理由を明示すれば許可）

**テストファイル配置例**:

```
tests/
  integration/
    controller-network.test.ts
    cardhost-jsapdu.test.ts
    router-auth.test.ts
```

#### 6.2.3 E2Eテスト（End-to-End Test）

**目的**: 実際のユースケースに近い環境でシステム全体が正しく動作することを確認

**必須シナリオ**:

```
完全なシステムフロー:
Controller (CLI) → Router → Cardhost (Mock)

具体的なテストケース:
1. 接続確立フロー
   - Controller が Router に接続
   - Cardhost が Router に接続
   - Controller が Cardhost UUID を指定して接続

2. APDU送受信フロー
   - Controller から APDU コマンド送信
   - Router 経由で Cardhost に到達
   - Cardhost がモックカードでレスポンス生成
   - レスポンスが Controller に返る
   - jsapdu-over-ip ライブラリの統合確認

3. 認証・認可フロー
   - 正しい認証情報での成功
   - 不正な認証情報での失敗
   - トークン失効後のアクセス拒否

4. エラーハンドリング
   - ネットワーク切断時の挙動
   - タイムアウト処理
   - カード未挿入時のエラー

5. セキュリティ
   - E2E暗号化の動作確認
   - メッセージ改ざん検知
   - リプレイ攻撃の防御
```

**要件**:

- 実際の通信を使用（HTTP/WebSocket）
- モックカードホストの使用（実デバイス不要）
- 環境構築の自動化
- テストの独立性（並列実行可能）

**テストファイル配置例**:

```
tests/
  e2e/
    full-system.test.ts
    authentication.test.ts
    error-handling.test.ts
    security.test.ts
```

### 6.3 テストカバレッジ要件

#### 6.3.1 最低カバレッジ目標

- ユニットテスト: 各モジュール 80% 以上
- 結合テスト: 主要フロー 100%
- E2Eテスト: クリティカルパス 100%

#### 6.3.2 テストケース数の目安

単一のテストファイルでは不十分。以下を参考に複数ファイルを作成:

- **ユニットテスト**: モジュールごとに 10～50 ケース
- **結合テスト**: 統合パターンごとに 5～20 ケース
- **E2Eテスト**: シナリオごとに 3～10 ケース

### 6.4 テストシナリオ分類

#### 6.4.1 正常系（Happy Path）

- 標準的な使用方法での動作確認
- 期待される入力と出力の検証

#### 6.4.2 準正常系（Alternative Path）

- やや変則的だが許容される動作
- リトライ、タイムアウト後の再接続等

#### 6.4.3 異常系（Error Path）

- 明らかな不正入力
- 権限エラー
- リソース不足

#### 6.4.4 エッジケース

- 境界値（最大・最小・ゼロ）
- 空文字列、null、undefined
- 極端に大きなデータ
- 同時接続数の上限
- タイミング依存の問題

### 6.5 テスト実装のアンチパターン

**禁止事項**:
❌ テストケース内での `console.log`（意味がない、削除すること）
❌ テストを通すことだけを目的としたコード
❌ モックプラットフォーム直接呼び出しのみのテスト（Issue #2 参照）
❌ 単一のテストファイルで全てを完結させる試み

**推奨事項**:
✅ 実際の通信フローを使用したテスト
✅ 各テストレベルの責務を明確に分離
✅ テストの意図が明確なアサーション
✅ テスト失敗時のデバッグが容易な構造

### 6.6 テストの哲学

> **テストの本質**: テストを通すことが目的ではない。
>
> テストのパス条件は、**Mission・Vision・Value に近づくための行動をテスト を通して示せていること**である。
>
> そのためには、複数のテストファイル・多数のテストケースが必要となる。

---

## 7. 開発規約

### 7.1 ドキュメント規約

#### 7.1.1 必須ルール

- 全てのドキュメントは `docs/` ディレクトリ配下に配置
- **禁止**: プロジェクトルートに `<大文字始まり>.md` ファイルを配置
  - 例: `README.md`, `CONTRIBUTING.md` 等はルートに置かない
  - 正: `docs/readme.md`, `docs/contributing.md`

#### 7.1.2 推奨構造

```
docs/
  ├── devnotes/              # 開発者が自由に書いてもいい領域
  ├── readme.md              # プロジェクト概要
  ├── what-to-make.md        # 本ドキュメント
  ├── architecture.md        # アーキテクチャ詳細
  ├── api-specification.md   # API仕様
  ├── security.md            # セキュリティ詳細
  ├── development-guide.md   # 開発ガイド
  └── testing-guide.md       # テスト実施ガイド
```

### 7.2 CI/CD

#### 7.2.1 必須CI

- **ビルドテスト**: `examples/` 配下の全プロジェクトをビルド
- **ユニットテスト**: 全モジュールのユニットテスト実行
- **結合テスト**: 主要な統合パターンのテスト実行
- **E2Eテスト**: クリティカルパスのE2Eテスト実行

#### 7.2.2 CI実行条件

- Pull Request 作成時
- main ブランチへのプッシュ時
- タグ作成時

### 7.3 コーディング規約

#### 7.3.1 TypeScript

- Strict モード必須（`strict: true`）
- ESLint + Prettier の使用
- 型定義の明示（`any` の使用は最小限に）

#### 7.3.2 CLI開発（Controller）

- Commander.js または Yargs の活用
- 適切なエラーハンドリングと終了コード
- ヘルプメッセージの充実
- 進捗表示（長時間処理時）
- 標準入出力の適切な使用

#### 7.3.3 命名規則

- **ファイル名**: kebab-case（例: `crypto-utils.ts`）
- **クラス名**: PascalCase（例: `CardHostManager`）
- **関数名**: camelCase（例: `sendApduCommand`）
- **定数**: UPPER_SNAKE_CASE（例: `MAX_RETRY_COUNT`）

---

## 8. 実装上の重要な注意事項

### 8.1 UUID管理の注意点

Cardhost の UUID は 128ビット（16バイト）であり、以下の点に留意:

- 衝突確率は極めて低いが、ゼロではない
- 長期的なトラッキングには追加の識別子、つまり鍵ペアを使用
- 名前参照としてUUIDを利用する
- UUID と公開鍵の組み合わせでより強固な識別を推奨

### 8.2 [`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip) の統合

- Controller と Cardhost の両方で必須
- インターフェースを通じた操作を徹底
- ライブラリのバージョンを統一

### 8.3 暗号化実装の注意

- 自作暗号プロトコルは**安全性の証明が必要**
- 既存の実証済みプロトコルの使用を推奨
- TLS は Controller-Router、Cardhost-Router 間で使用
  - ただし、TLS は E2E 暗号化の代替にはならない

### 8.4 WebSocket 接続管理

- 切断時の自動再接続機構
- ハートビート（Ping/Pong）の実装
- タイムアウト設定

---

## 付録: 参考資料

- [`jsapdu-over-ip` リポジトリ](https://github.com/AokiApp/jsapdu-over-ip)
- [`jsapdu` ドキュメント](https://raw.githubusercontent.com/AokiApp/jsapdu/refs/heads/dev/README.md)
- [Hono ドキュメント](https://hono.dev/)
- [Vitest ドキュメント](https://vitest.dev/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

---

**最終更新**: 2025-12-08  
**バージョン**: 2.0
