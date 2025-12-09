# Handoff Package - Complete Understanding Set

**Date**: 2025-12-09
**Purpose**: Package for next development phase
**Selected**: Complete Understanding Set

---

## 🚨 CRITICAL: Do This FIRST (Before Reading Any Documents)

### Step 0: Clone and Study jsapdu Repositories

**⚠️ MANDATORY PREREQUISITE**

From [`research-jsapdu-joip.md`](research-jsapdu-joip.md):

> **⚠️ CRITICAL FOR AI AGENTS**: If you're reading this, you MUST clone the repositories and read the markdown files recursively.

**YOU MUST DO THIS**:

```bash
# 1. Verify jsapdu is cloned (should already exist)
cd research/jsapdu
git pull  # Get latest updates

# 2. Read ALL documentation recursively
cat docs/README.md                              # Start here
cat docs/architecture/package-interactions.md   # Architecture
cat packages/interface/docs/extended-apdu.md    # APDU details
cat packages/pcsc/docs/async-mutex.md           # Concurrency
cat packages/mynacard/docs/tlv-schemas.md       # Data parsing

## 2.5. Read linked files recursively
cat docs/README.md | grep -oE '\[.*\]\((.*)\)' | sed 's/.*(\(.*\)).*/\1/'

# 3. Study abstractions
cat packages/interface/src/abstracts.ts         # Core interfaces

# 4. Check jsapdu-over-ip implementation
cd ../jsapdu-over-ip
cat README.md
cat src/client/platform-proxy.ts                # Client side
cat src/server/platform-adapter.ts              # Server side
cat src/transport.ts                            # Transport abstraction
```

**Why This Matters**:

- jsapdu-over-ip provides **RPC**, NOT encryption
- Understanding the abstraction layers prevents mistakes
- Resource management patterns (`await using`) are non-obvious
- Error handling across 6 layers requires study

**Consequence of Skipping**:

- Code corruption (incompatible implementations)
- Memory leaks (unclosed handles)
- Protocol violations (silent failures)
- As documented in research-jsapdu-joip.md failure scenarios

**Time Required**: 1-2 hours (but saves 10+ hours of debugging)

## 🧠 Mechanism-Based Guardrails: なぜを潰す

このセクションは「なぜ」を解消するための機序（メカニズム）に立脚したガードレールを定義します。AIエージェント/人間開発者いずれにも有効です。

### 行動の傾向（悪いパターン）と「なぜなぜ」分析

- 近視眼的最適化（Quick Wins 先行）
  - なぜ？: 成果の即時可視化（グリーンテスト）を優先しがち
    - なぜ？: 読解の成功指標が曖昧で、短期の評価軸に乗りづらい
      - なぜ？: 手順ガード（読解→要約→設計→実装のゲート）が設定されていない
        - なぜ？: プロセス定義に「Step 0 読解完了を証跡化する契約」が欠落
- ツール誘因（編集→テストの連鎖）
  - なぜ？: 1メッセージ1ツールの運用だと「差分適用→テスト」の即時フィードバックが続きやすい
    - なぜ？: 読解は複数ファイルの連続読込＋要約作成が必要で成功指標が遅延
      - なぜ？: 読解の完了定義（ファイル一覧・要点要約・契約マッピング）の数値化が無い
- 仕様理解の飛ばし（契約未把握のまま実装）
  - なぜ？: jsapdu-over-ip の契約（[TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14), [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35), [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93), [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32)）の要点整理を先にせず着手
    - なぜ？: 設計メモ（データフロー/エラーフロー/境界の明文化）作成が義務化されていない
      - なぜ？: デザインDoD（Definition of Done）が定義されていない
- 確証バイアス（「テストが通る＝正しい」と誤認）
  - なぜ？: 既存テストがライブラリ層中心で、ネットワーク/暗号のギャップを露呈しない
    - なぜ？: WebSocketリレーとE2E暗号のテスト設計が未整備

### 対策（実行ガードレール）

- Gate A: 読解ゲート（Step 0 完了の証跡なしに実装禁止）
  - docs/devnotes/STEP0-SUMMARY.md を作成（PRに含める）
    - 読了ファイル一覧（箇条書）
    - 契約マッピング（行番号付き参照）
      - 例: [TypeScript.SmartCardPlatform.init()](research/jsapdu/packages/interface/src/abstracts.ts:38), [TypeScript.SmartCardDevice.startSession()](research/jsapdu/packages/interface/src/abstracts.ts:288), [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14), [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)
    - 「RPC と暗号は分離」の明文化（Router は透過中継）
- Gate B: 設計ゲート（P0 着手前に 1 ページ設計メモ）
  - docs/devnotes/DESIGN-NOTES-P0.md を作成（PRに含める）
    - WebSocket リレー設計: エンドポイント (/api/jsapdu/ws)、ヘッダ（x-role, x-cardhost-uuid, x-session-token）、接続プール、再接続/心拍の方針、[packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180) の置換方針
    - E2E 暗号レイヤ: ECDH→HKDF→AES-GCM、メッセージ署名 Ed25519、ノンス/シーケンス/リプレイ対策、Router は暗号文のみを中継
    - エラーフロー: 認証失敗/接続断/タイムアウト/逆方向イベントの伝搬
- Gate C: ツール運用ルール（AIエージェント/人間共通）
  - 読解は可能な限り一括で実施（関連ファイルをまとめて読み出し→要点要約を先に作成）
  - Gate A/B の成果物がない場合、差分適用（コード編集）を開始しない
  - 「テストが通る」を実装着手の許可条件にしない（読解/設計の完了が先）
- Red Flags（1つでも該当すれば中断）
  - 要約なしでコード編集を開始している
  - jsapdu-over-ip の契約と暗号レイヤの境界を説明できない
  - ライブラリ層のテストだけで「完成」と判断している
  - [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180) のプレースホルダを残したまま次工程へ進もうとしている
- Step 0 の DoD（Definition of Done）
  - STEP0-SUMMARY.md と DESIGN-NOTES-P0.md が存在し、PRでレビュー可能
  - 契約マッピング（代表 API と行番号）が含まれる
  - 「RPCと暗号分離」「Router透過中継」の文言が明文化されている

---

## 📦 Documents to Review (After Cloning - Priority Order)

### 1. [`research-jsapdu-joip.md`](research-jsapdu-joip.md) ⭐⭐⭐

**Read Second** - Technical Foundation

**Why Read**:

- Understand jsapdu architecture (6 abstraction layers)
- Understand jsapdu-over-ip purpose (RPC, NOT encryption)
- Learn correct patterns (`await using`, resource management)
- See real failure scenarios from developers who didn't read docs

**Key Takeaway**:

> jsapdu-over-ip provides **transport-agnostic RPC** for SmartCardPlatform interface.
> It does NOT provide E2E encryption. That must be implemented separately.

**Time**: 10-15 minutes

---

### 2. [`REQUIREMENTS-COMPLIANCE-ANALYSIS.md`](REQUIREMENTS-COMPLIANCE-ANALYSIS.md) ⭐⭐⭐

**Read Second** - What's Missing

**Why Read**:

- Comprehensive spec verification (674 lines checked)
- Compliance score: 63% (C+)
- **3 Critical Findings** that change everything
- Priority-ordered action items

**Critical Findings**:

**Finding 1: E2E Encryption Misunderstanding** 🚨

```
We assumed: jsapdu-over-ip provides E2E encryption
Reality: jsapdu-over-ip only provides RPC serialization
Spec requires: ECDH + AES-GCM + message signatures (Section 4.3, 5.1)
Status: NOT IMPLEMENTED
```

**Finding 2: WebSocket Protocol Incomplete** 🚨

```
Issue: Router has no /api/jsapdu/ws WebSocket handler
Impact: Cardhost cannot connect, APDU cannot flow
Status: PLACEHOLDER CODE ONLY
```

**Finding 3: Many Missing Features** ⚠️

```
- Auto-reconnection
- Heartbeat mechanism
- Card event detection
- Monitor UI
- Rate limiting
- TLS enforcement
- 10+ more features
```

**Compliance Breakdown**:

- Must-Have (10 items): 6/10 = 60% ❌
- Should-Have (10 items): 0/10 = 0% ❌
- Protocol Section: 40% ❌
- Security Section: 60% ⚠️

**Time**: 20-30 minutes

---

### 3. [`CODE-QUALITY-REVIEW-COMPLETE.md`](CODE-QUALITY-REVIEW-COMPLETE.md) ⭐⭐

**Read Third** - Implementation Details

**Why Read**:

- Code quality score: B+ (87/100) - Good but not perfect
- Specific issues with file:line references
- 133 lines of code duplication identified
- 22 missing tests identified
- Security vulnerabilities listed

**Key Issues**:

**Code Duplication** (133 lines):

1. `canonicalizeJson` function (88 lines, 2 files)
2. Hex parsing logic (45 lines, 3 files)

**Missing Tests** (22 tests needed):

1. SessionManager (Controller) - 8 tests
2. AuthManager (Cardhost) - 8 tests
3. Transport layers - 6 tests

**Minor Issues**:

- Private property access via bracket notation
- console.error in library code
- Magic numbers not extracted

**Time**: 15-20 minutes

---

### 4. [`docs/what-to-make.md`](../what-to-make.md) 📖

**Reference** - Original Specification

**Why Include**:

- 674-line complete specification
- Use as reference when implementing fixes
- REQUIREMENTS-COMPLIANCE-ANALYSIS cites specific sections

**Don't Read Sequentially**:

- Use as lookup when REQUIREMENTS-COMPLIANCE-ANALYSIS mentions sections
- Example: "See Section 4.3 for E2E encryption requirements"

**Time**: Reference only (not read end-to-end)

---

## 🎯 What to Do Next

### Phase 1: Critical Fixes (P0)

**Priority 0-1: Implement E2E Encryption** (40-60 hours)

- Location: New layer wrapping jsapdu-over-ip
- Requirements: Section 4.3, 5.1 of spec
- Components: ECDH key exchange, AES-GCM encryption, Ed25519 message signatures
- Files to create:
  - `packages/shared/src/crypto/e2e-encryption.ts`
  - `packages/controller/src/lib/e2e-wrapper.ts`
  - `packages/cardhost/src/lib/e2e-wrapper.ts`

**Priority 0-2: Implement WebSocket RPC Relay** (20-30 hours)

- Location: `packages/router/src/runtime/websocket-handler.ts`
- Requirements: Section 4.1.2, 4.2.2 of spec
- Components: WebSocket upgrade, RPC message routing, connection pool
- Fix: `packages/router/src/lib/relay/session-relay.ts:174-180` (placeholder)

### Phase 2: Quality Improvements (P1-P2)

**Priority 1: Add Missing Tests** (15-20 hours)

- SessionManager: 8 tests
- AuthManager: 8 tests
- Transports: 6 tests
- Target coverage: 80%

**Priority 2: Refactor Duplicated Code** (5-10 hours)

- Extract `canonicalizeJson` to shared
- Extract hex parsing to utility
- Create HTTP client wrapper

### Phase 3: Feature Completion (P3)

**Nice-to-have features** (40+ hours):

- Auto-reconnection
- Heartbeat with signatures
- Card event detection
- Monitor UI
- Rate limiting
- TLS enforcement
- Progress display
- YAML support
- Pipe processing

---

## 📊 Current State Summary

### What Works ✅

- ✅ Library-first architecture (correct)
- ✅ jsapdu-over-ip RPC integration (correct)
- ✅ MockSmartCardPlatform (excellent implementation)
- ✅ Authentication flows (both Controller and Cardhost)
- ✅ 28 meaningful tests passing
- ✅ Proper `await using` throughout
- ✅ Clean separation lib/runtime

### What Doesn't Work ❌

- ❌ E2E encryption (spec Section 4.3 - NOT implemented)
- ❌ WebSocket RPC relay (Cardhost cannot actually connect)
- ❌ Message signatures on APDU (spec Section 5.3 - NOT implemented)
- ❌ Full end-to-end APDU flow (no real networking test)

### Test Results

```bash
$ npm test
✓ 28/28 tests passed
```

**But**: Tests use library APIs directly, not full network stack

### Build Status

```bash
$ npm run build
✓ All packages compile
✓ No TypeScript errors
```

---

## 🔑 Key Insights for Next Developer

### Insight 1: jsapdu-over-ip Role

**What it does**: RPC serialization for SmartCardPlatform interface  
**What it doesn't do**: E2E encryption, message authentication  
**Implication**: Must add encryption layer AROUND jsapdu-over-ip

### Insight 2: Architecture is Correct

- Library-first design: ✅ Correct
- Separation of concerns: ✅ Correct
- Resource management: ✅ Correct
- **Don't redesign**: Build on this foundation

### Insight 3: Tests Are Meaningful But Incomplete

- Current tests: ✅ Good quality, educational
- Coverage: ⚠️ 60% (need 80%)
- Network tests: ❌ Missing (mocked out)
- **Don't rewrite tests**: Add missing ones

### Insight 4: Quick Wins Available

- Refactor duplicated code: 2-3 hours
- Add basic tests: 5-10 hours
- Extract constants: 1 hour
- **Low-hanging fruit**: Do these first

---

## 📋 Reading Order Recommendation

### Day 1: Understanding (Total: ~1 hour)

1. Read [`research-jsapdu-joip.md`](research-jsapdu-joip.md) - 15 min
   - **Focus**: jsapdu-over-ip capabilities and limitations
2. Read [`REQUIREMENTS-COMPLIANCE-ANALYSIS.md`](REQUIREMENTS-COMPLIANCE-ANALYSIS.md) - 30 min
   - **Focus**: Section "Critical Findings" and compliance matrix
3. Skim [`CODE-QUALITY-REVIEW-COMPLETE.md`](CODE-QUALITY-REVIEW-COMPLETE.md) - 15 min
   - **Focus**: Priority 1-2 issues

### Day 2: Implementation Planning

4. Deep read [`REQUIREMENTS-COMPLIANCE-ANALYSIS.md`](REQUIREMENTS-COMPLIANCE-ANALYSIS.md)
   - Note all P0 and P1 items
5. Reference [`docs/what-to-make.md`](../what-to-make.md)
   - Sections 4.3 (E2E encryption)
   - Sections 5.1-5.3 (Security design)

### Day 3: Start Coding

6. Review existing code with quality document in hand
7. Start with Priority 0-1 (E2E encryption)

---

## 🎓 Success Criteria for Next Phase

### Minimum (80% compliance)

- [ ] E2E encryption implemented (ECDH + AES-GCM)
- [ ] WebSocket RPC relay functional
- [ ] Full network E2E test passing
- [ ] Test coverage ≥ 80%

### Target (90% compliance)

- [ ] Above + Message signatures on APDU
- [ ] Above + Auto-reconnection
- [ ] Above + Heartbeat mechanism
- [ ] Above + Rate limiting

### Ideal (95% compliance)

- [ ] Above + All should-have features
- [ ] Above + Monitor UI
- [ ] Above + TLS enforcement
- [ ] Above + CI/CD pipeline

---

## 📞 Contact Points

If questions arise during implementation:

**Architecture questions**: See PROPER-ARCHITECTURE-DESIGN.md  
**Historical context**: See CRITICAL-PROBLEMS-ANALYSIS.md  
**Test philosophy**: See spec Section 6.6  
**jsapdu patterns**: See research-jsapdu-joip.md real failure scenarios

---

## ✅ Checklist Before Starting (CRITICAL ORDER)

### Phase 0: Repository Study (MANDATORY - 1-2 hours)

- [ ] **Verify research/jsapdu/ exists**: `cd research/jsapdu && git pull`
- [ ] **Verify research/jsapdu-over-ip/ exists**: `cd research/jsapdu-over-ip && ls`
- [ ] **Read jsapdu docs recursively**: Start with `docs/README.md`, follow ALL links
- [ ] **Study core abstractions**: `packages/interface/src/abstracts.ts`
- [ ] **Understand jsapdu-over-ip**: Read source code in `src/`
- [ ] **Key realization**: jsapdu-over-ip = RPC only, NOT encryption
- [ ] **Produce STEP0-SUMMARY.md** (commit to repo)
  - Include: read files list, key takeaways, and contract mapping with line refs
  - Minimum mapping: [TypeScript.SmartCardPlatform.init()](research/jsapdu/packages/interface/src/abstracts.ts:38), [TypeScript.SmartCardDevice.startSession()](research/jsapdu/packages/interface/src/abstracts.ts:288), [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14), [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35), [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93), [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32)
  - Explicit statement: "RPC と暗号は分離（Router は暗号文の透過中継）"
- [ ] **Produce DESIGN-NOTES-P0.md** (commit to repo)
  - WebSocket relay design: `/api/jsapdu/ws`, roles/headers, session validation, connection pool
  - Relay fix plan for [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180)
  - E2E crypto plan: ECDH→HKDF→AES-GCM + Ed25519 signatures; nonce/seq/replay policy
- [ ] **Red Flags check (halt if any)**
  - No summary/design notes yet / Cannot explain RPC–crypto boundary / Tests only at library level

### Phase 1: Context Documents (45-60 minutes)

- [ ] Read `research-jsapdu-joip.md` summary
- [ ] Read `REQUIREMENTS-COMPLIANCE-ANALYSIS.md` thoroughly
- [ ] Read `CODE-QUALITY-REVIEW-COMPLETE.md` thoroughly
- [ ] Have `docs/what-to-make.md` open for reference

### Phase 2: Understanding Critical Issues (15 minutes)

- [ ] Understand Finding 1: E2E encryption missing (jsapdu-over-ip doesn't provide it)
- [ ] Understand Finding 2: WebSocket RPC relay is placeholder only
- [ ] Understand Finding 3: Many features unimplemented (10+)
- [ ] Note: Tests pass (28/28) but system incomplete

### Phase 3: Code Review (30 minutes)

- [ ] Review existing code structure (lib/ vs runtime/)
- [ ] Identify code duplication (133 lines noted)
- [ ] Identify missing tests (22 tests noted)
- [ ] Understand: Don't redesign, build on foundation

### Phase 4: Ready to Start

- [ ] Development environment set up
- [ ] P0 tasks identified (E2E encryption + WebSocket)
- [ ] Ready to implement fixes

---

**Good Luck!** The foundation is solid. Focus on P0 items first.

---

## 🗂️ Document Paths

Copy these paths for easy access:

```
docs/devnotes/research-jsapdu-joip.md
docs/devnotes/REQUIREMENTS-COMPLIANCE-ANALYSIS.md
docs/devnotes/CODE-QUALITY-REVIEW-COMPLETE.md
docs/what-to-make.md
```

Optional reference:

```
docs/devnotes/PROPER-ARCHITECTURE-DESIGN.md
docs/devnotes/CRITICAL-PROBLEMS-ANALYSIS.md
docs/devnotes/REBUILD-COMPLETE.md
```

## response from fixer

本フェーズ（Step 0 証跡化＋QIP）の結論を、当ドキュメントの構成と文体に合わせて記録します。

### 未実施事項（現状／理由／次の一手）

1. E2E 暗号レイヤ（ECDH→HKDF→AES-GCM + Ed25519）

```
Status: NOT IMPLEMENTED
Scope: P0 Security Layer
Reason: 「RPC と暗号は分離（Router は暗号文の透過中継）」の原則を厳守。暗号は jsapdu-over-ip 外側の新規レイヤとして、spec 4.3/5.1–5.3 準拠・鍵管理・署名検証を伴う設計が必要。
Next: 設計→実装→テスト（ネットワーク＋E2E暗号）を次フェーズで開始。
Location: [packages/shared/src/crypto/e2e-encryption.ts](packages/shared/src/crypto/e2e-encryption.ts:1), [packages/controller/src/lib/e2e-wrapper.ts](packages/controller/src/lib/e2e-wrapper.ts:1), [packages/cardhost/src/lib/e2e-wrapper.ts](packages/cardhost/src/lib/e2e-wrapper.ts:1)
Contracts: [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14), [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)
```

2. APDU メッセージ署名（spec 5.3）

```
Status: NOT IMPLEMENTED
Scope: P0 Security Layer（E2E と一体）
Reason: 署名は暗号レイヤと一体で設計すべき。単独導入は境界誤認・脆弱性の温床。
Next: E2E ラッパ導入と同時適用。契約は [docs/what-to-make.md](docs/what-to-make.md:1) に準拠して明文化。
```

3. Router ランタイム test-server ヘルパ抽出

```
Status: PENDING
Scope: Refactor
Reason: 現状の in-process 制御（[TypeScript.startRuntimeServer()](packages/router/src/runtime/server.ts:193), [TypeScript.main()](packages/router/src/runtime/server.ts:319)）で安定。E2E 直後の大規模置換はリスクが高い。
Next: [packages/router/src/runtime/test-server.ts](packages/router/src/runtime/test-server.ts:1) を追加し、start()/stop() API をテスト全体へ適用。
```

4. テスト内 URL ハードコード撤去（http://localhost:3000）

```
Status: PARTIAL
Files:
- [tests/integration/cardhost-jsapdu.test.ts](tests/integration/cardhost-jsapdu.test.ts:20)
- [tests/integration/full-system.integration.test.ts](tests/integration/full-system.integration.test.ts:36)
- [tests/e2e/full-system.test.ts](tests/e2e/full-system.test.ts:35)
Reason: 既存インテグレーションの一部が固定 URL 前提。現フェーズは「動作安定」を優先。
Next: BASE_URL／設定注入に統一してハードコードを撤去。
```

5. Nice-to-have 群（Auto-reconnection／Heartbeat（署名付）／Rate limiting／TLS／Monitor UI 等）

```
Status: NOT IMPLEMENTED
Scope: P3 Feature Completion
Reason: 暗号レイヤ完了後に最適化。TLS は外部インフラ依存。
Next: 暗号レイヤ完了後に順次着手。
```

---

### このフェーズで達成したこと（目的適合）

- 実ネットワーク E2E（HTTP+WS, 単一プロセス）成立・安定化
  - ランタイム制御: [TypeScript.startRuntimeServer()](packages/router/src/runtime/server.ts:193), [TypeScript.main()](packages/router/src/runtime/server.ts:319)
- 初期化競合の解消（クライアント／サーバ）
  - クライアント強制初期化: [TypeScript.ControllerClient.connect()](packages/controller/src/lib/controller-client.ts:90)
  - サーバ idempotent: [TypeScript.SmartCardPlatformAdapter.dispatch()](research/jsapdu-over-ip/src/server/platform-adapter.ts:80)
- RPC–暗号分離の維持（Router は暗号文の透過中継）
- jsapdu 契約準拠フロー（platform → device → card）の確認
  - [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93)

### 結論

- 目的（理解の証跡化／ネットワーク動作の安定化／品質改善）は達成。
- 次フェーズ開始条件は「暗号レイヤ（P0）着手」。
- 「RPC と暗号は分離（Router は暗号文の透過中継）」の原則を維持したまま進める。
