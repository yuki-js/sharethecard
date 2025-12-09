# Implementation Issues Report

Generated: 2025-12-09
Status: Test cleanup completed, now reviewing implementation

## Test Cleanup Summary

**Before**: 72 tests in 9 files
**After**: 27 tests in 5 files
**Removed**: 45 meaningless test cases

### Deleted Files

- `tests/unit/auth-manager.test.ts` - fetch mock "was it called?" tests
- `tests/unit/auth-manager.getter.test.ts` - tautological getter/setter tests
- `tests/unit/session-manager.test.ts` - fetch mock "was it called?" tests
- `tests/e2e/full-system.test.ts` - complete duplicate of integration test

### Removed Test Cases

- HTTP header validation tests (implementation detail)
- `typeof === 'function'` interface checks (TypeScript already validates)
- `await using` with only `toBeDefined()` (tautological)
- Getter/setter tautologies
- Tests with no assertions (only comments saying "this demonstrates API pattern")
- Scope cleanup tests that don't actually verify cleanup

### Remaining Tests (All Meaningful)

1. `tests/unit/session-relay.test.ts` - RPC relay mechanics
2. `tests/unit/router-transports.test.ts` - Transport protocol handling
3. `tests/integration/cardhost-jsapdu.test.ts` - jsapdu integration
4. `tests/integration/full-system.integration.test.ts` - Component interaction
5. `tests/e2e/network-e2e.test.ts` - Real network E2E

---

## 🔴 Critical Issues (Spec Violations)

### 1. E2E Encryption NOT IMPLEMENTED

**Severity**: CRITICAL
**Spec Reference**: docs/what-to-make.md Section 4.3, 5.1

**Current State**:

- Controller → Router → Cardhost communication is **plain RPC**
- Router can read all APDU commands and responses
- No ECDH key exchange
- No AES-256-GCM encryption
- No message authentication (EdDSA signatures)

**Spec Requirement**:

```
Controller ⇄ Cardhost (E2E)
- Key Exchange: ECDH (Elliptic Curve Diffie-Hellman)
- Session Key: HKDF from ECDH shared secret
- Encryption: AES-256-GCM (AEAD)
- Router: Cannot decrypt, only relays encrypted payloads
```

**Impact**:

- **Security**: Router compromise exposes all card data
- **Compliance**: Violates "Router を信頼せずに" principle
- **Architecture**: RPC protocol needs redesign to support encrypted payloads

**Affected Files**:

- `packages/controller/src/lib/router-transport.ts`
- `packages/cardhost/src/lib/router-transport.ts`
- `packages/router/src/lib/relay/session-relay.ts`
- `packages/shared/src/types/index.ts` (needs E2E message types)

---

### 2. Message Authentication Missing

**Severity**: HIGH
**Spec Reference**: docs/what-to-make.md Section 5.3

**Current State**:

- No digital signatures on messages
- No message authentication codes
- Replay attack vulnerability
- No timestamp/nonce validation

**Spec Requirement**:

```
全ての重要なメッセージに署名を付与：
- 接続確立メッセージ
- APDU コマンド/レスポンス
- ハートビート
- セッション制御メッセージ

原則: デジタル署名（EdDSA/ECDSA）を使用
```

---

### 3. UUID Management Incomplete

**Severity**: MEDIUM
**Spec Reference**: docs/what-to-make.md Section 8.1

**Current State**:

- UUID は 128-bit で生成・永続化されている ✅
- しかし「UUID + 公開鍵の組み合わせ」が実装されていない
- 長期トラッキングに対する追加識別子が不足

**Spec Requirement**:

```
- 長期的なトラッキングには追加の識別子、つまり鍵ペアを使用
- 名前参照としてUUIDを利用する
- UUID と公開鍵の組み合わせでより強固な識別を推奨
```

**Current Implementation**:

- `ConfigManager` generates UUID ✅
- `ConfigManager` generates Ed25519 keypair ✅
- But UUID + public key combination is not enforced in Router

---

## ⚠️ jsapdu Pattern Compliance Issues

### 4. Error Handling Patterns

**Severity**: MEDIUM

**Issues**:

- `RemoteSmartCardError` exists but not consistently used
- Error codes don't fully match jsapdu error taxonomy
- Some errors are generic `Error` instead of `SmartCardError`

**jsapdu Pattern**:

```typescript
// From research/jsapdu/packages/interface/src/abstracts.ts
throw new SmartCardError(
  "CARD_NOT_PRESENT", // Specific error code
  "No card detected", // Human-readable message
);
```

**Current Issues**:

```typescript
// controller-client.ts line 154
throw new Error("Card not present. Insert card and try again.");
// Should be: SmartCardError with code
```

### 5. Resource Lifecycle Management

**Severity**: LOW-MEDIUM

**Issues**:

- `await using` pattern is implemented ✅
- But some cleanup paths use `catch(() => {})` which swallows errors
- Disposal errors should be logged, not silently ignored

**Example** (controller-client.ts:160-164):

```typescript
try {
  await card.release();
} catch {
  // Ignore cleanup errors on release to prevent masking primary results
}
```

**Better Pattern**:

```typescript
try {
  await card.release();
} catch (err) {
  console.warn("Card cleanup error:", err);
  // Still continue, but log for debugging
}
```

---

## 📋 Architecture Alignment Issues

### 6. Library vs Runtime Separation

**Severity**: LOW
**Spec Reference**: docs/what-to-make.md Section 3.5

**Current State**:

- Separation exists partially ✅
- But some library code has runtime assumptions
- Example: `CardhostService` assumes network transport

**Spec Requirement**:

```
- cardhost, router, controllerは通常はスタンドアローンで動作する
- テストランナーで動作できるように、ライブラリとしても提供される
- ライブラリに対して、ランタイムという下駄を履かせる形に
```

**Status**: Mostly compliant, minor improvements possible

---

### 7. Documentation Compliance

**Severity**: LOW
**Spec Reference**: docs/what-to-make.md Section 7.1

**Current State**:

- All docs are in `docs/` ✅
- No `<Uppercase>.md` files in project root ✅
- `devnotes/` exists for development notes ✅

**Status**: Fully compliant ✅

---

## 🔧 Implementation Quality Issues

### 8. Mock Platform Limitations

**Severity**: LOW

**Issues**:

- `MockSmartCardPlatform` works well for testing
- But doesn't simulate timing issues
- Doesn't simulate card removal mid-transaction
- Doesn't test error recovery

**Recommendation**: Acceptable for current testing needs, but consider enhanced mock for edge case testing

---

### 9. Transport Protocol Consistency

**Severity**: LOW-MEDIUM

**Issue**:

- `RouterClientTransport` (Controller) uses fetch ✅
- `RouterServerTransport` (Cardhost) uses WebSocket ✅
- But error handling differs between transports
- Retry logic is missing

**Recommendation**: Standardize error handling and add exponential backoff for reconnection

---

## 📊 Priority Matrix

| Issue                    | Severity | Effort | Priority | Blocks E2E Crypto |
| ------------------------ | -------- | ------ | -------- | ----------------- |
| 1. E2E Encryption        | CRITICAL | HIGH   | 🔴 P0    | Yes (root cause)  |
| 2. Message Auth          | HIGH     | MEDIUM | 🔴 P0    | Yes (part of E2E) |
| 3. UUID + Key Combo      | MEDIUM   | LOW    | 🟡 P1    | No                |
| 4. Error Handling        | MEDIUM   | LOW    | 🟡 P1    | No                |
| 5. Resource Cleanup      | LOW-MED  | LOW    | 🟢 P2    | No                |
| 6. Lib/Runtime Sep       | LOW      | LOW    | 🟢 P2    | No                |
| 7. Documentation         | LOW      | N/A    | ✅ Done  | No                |
| 8. Mock Enhancements     | LOW      | MEDIUM | 🟢 P3    | No                |
| 9. Transport Consistency | LOW-MED  | LOW    | 🟡 P1    | No                |

---

## 🎯 Recommended Action Plan

### Phase 1: E2E Encryption Foundation (P0)

1. Design encrypted payload wrapper protocol
2. Implement ECDH key exchange in Controller/Cardhost
3. Implement AES-256-GCM encryption/decryption
4. Add EdDSA message signatures
5. Update Router to relay encrypted payloads only

**Estimated Effort**: 8-12 hours
**Risk**: High (major architectural change)

### Phase 2: Security Hardening (P0-P1)

1. Implement replay attack prevention (nonce/timestamp)
2. Add UUID + public key validation in Router
3. Standardize error handling patterns
4. Add transport retry logic

**Estimated Effort**: 4-6 hours
**Risk**: Medium

### Phase 3: Quality Improvements (P1-P2)

1. Improve resource cleanup logging
2. Enhance mock platform with edge cases
3. Add comprehensive E2E encryption tests
4. Update documentation

**Estimated Effort**: 2-4 hours
**Risk**: Low

---

## 🚨 Decision Required

**Question**: Given the critical E2E encryption issue, should we:

**Option A**: Implement E2E encryption now (8-12 hours)

- Pros: Spec compliant, secure
- Cons: Large scope, high risk, tests will need updates

**Option B**: Document the issue and proceed with smaller fixes first

- Pros: Incremental progress, lower risk
- Cons: Security remains non-compliant

**Option C**: Defer E2E encryption, focus on jsapdu pattern compliance

- Pros: Improves code quality without major changes
- Cons: Core security feature remains missing

**Recommendation**: Proceed with Option C (jsapdu compliance) first, then reassess E2E encryption implementation.
