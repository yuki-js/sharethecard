# Critical Problems Analysis - Current Implementation

**Date**: 2025-12-09  
**Status**: 🚨 EMERGENCY - Complete Rebuild Required

## Executive Summary

The current implementation has **FUNDAMENTAL ARCHITECTURAL VIOLATIONS** that make it unusable. This is not a matter of small fixes - the entire codebase must be destroyed and rebuilt from scratch following the specification.

---

## 🔥 Critical Violation #1: NOT Using jsapdu-over-ip

### What the Spec Says
[`docs/what-to-make.md:6`](docs/what-to-make.md:6):
> [`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip) ライブラリを活用した、サーバーを介したリモートAPDU送受信システムの構築。

### What We Have
- Custom crypto implementation in [`packages/shared/src/crypto/`](packages/shared/src/crypto/)
- Custom protocol in [`packages/shared/src/protocol/messages.ts`](packages/shared/src/protocol/messages.ts)
- **ZERO integration with jsapdu-over-ip**

### What Should Exist
```typescript
// Controller should use:
import { RemoteSmartCardPlatform, FetchClientTransport } from '@aokiapp/jsapdu-over-ip/client';

// Cardhost should use:
import { SmartCardPlatformAdapter } from '@aokiapp/jsapdu-over-ip/server';
import { PcscPlatform } from '@aokiapp/jsapdu-pcsc';

// Router should BRIDGE the transport, NOT implement custom protocol
```

### Impact
- **100% of crypto code is redundant**
- **100% of protocol code is redundant**
- Current implementation cannot interoperate with jsapdu ecosystem
- Violates core mission: "jsapdu インターフェースを通じたシームレスなAPDU通信"

---

## 🔥 Critical Violation #2: Architecture Not Library-First

### What the Spec Says
[`docs/what-to-make.md:240-242`](docs/what-to-make.md:240-242):
> - cardhost, router, controllerは通常はスタンドアローンで動作する
> - テストランナーで動作できるように、ライブラリとしても提供される
> - ライブラリに対して、ランタイムという下駄を履かせる形にしてスタンドアローンで動作するようになる。

### What We Have

**Controller**: [`packages/controller/src/`](packages/controller/src/)
- ❌ [`cli.ts`](packages/controller/src/cli.ts) is entry point
- ❌ [`lib.ts`](packages/controller/src/lib.ts) mixes session management with CLI concerns
- ❌ Functions like `establishSession()` are not part of a testable library class
- ❌ No clear separation: library vs runtime

**Cardhost**: [`packages/cardhost/src/index.ts`](packages/cardhost/src/index.ts)
- ❌ Entire service in one file (358 lines)
- ❌ `main()` function at bottom - no library export
- ❌ Cannot be imported and tested without running the service
- ❌ Hardcoded WebSocket and config management

**Router**: [`packages/router/src/index.ts`](packages/router/src/index.ts)
- ❌ Single 386-line monolith
- ❌ `serve()` called at module level - cannot test without starting server
- ❌ No exported library functions
- ❌ Global state in Maps at module level

### What Should Exist

```
packages/controller/
  src/
    lib/
      controller-client.ts      # ControllerClient class (library)
      session-manager.ts        # Session management (library)
      apdu-executor.ts          # APDU execution logic (library)
    runtime/
      cli.ts                    # CLI wrapper (uses lib/)
      
packages/cardhost/
  src/
    lib/
      cardhost-service.ts       # CardhostService class (library)
      config-manager.ts         # Config management (library)
      mock-platform.ts          # Mock for testing (library)
    runtime/
      main.ts                   # Standalone service (uses lib/)

packages/router/
  src/
    lib/
      router-core.ts            # Router class (library)
      auth-manager.ts           # Authentication (library)
      session-relay.ts          # Session relay logic (library)
    runtime/
      server.ts                 # Hono server (uses lib/)
```

### Impact
- **Cannot write meaningful tests** - everything requires spawning processes
- **Cannot compose** - no library API to build upon
- **Violates testability principle** from spec Section 6
- Makes E2E testing impossible without full deployment

---

## 🔥 Critical Violation #3: Tests Are Meaningless

### What the Spec Says
[`docs/what-to-make.md:570-572`](docs/what-to-make.md:570-572):
> テストのパス条件は、**Mission・Vision・Value に近づくための行動をテスト を通して示せていること**である。

[`docs/what-to-make.md:557-560`](docs/what-to-make.md:557-560):
> **禁止事項**:
> ❌ テストケース内での `console.log`（意味がない、削除すること）
> ❌ テストを通すことだけを目的としたコード
> ❌ モックプラットフォーム直接呼び出しのみのテスト

### What We Have

**Unit Tests**: [`tests/unit/`](tests/unit/)
- ✅ Crypto tests are good - but crypto shouldn't exist!
- ❌ No tests for actual business logic
- ❌ No tests for jsapdu integration (because there is none)

**Integration Tests**: [`tests/integration/router-auth.test.ts`](tests/integration/router-auth.test.ts)
- ❌ ALL expect statements are commented out!
- ❌ Tests don't actually verify anything
- ❌ Example: Line 28-30: `// expect(res.ok).toBe(true);` (commented)
- ❌ This is "通すことだけを目的としたコード" - exactly what spec forbids

**E2E Tests**: [`tests/e2e/full-system.test.ts`](tests/e2e/full-system.test.ts)
- ❌ Doesn't test the actual system
- ❌ Tests crypto functions in isolation
- ❌ No Controller → Router → Cardhost flow
- ❌ No jsapdu-over-ip integration testing
- ❌ Violates spec requirement: "Controller (CLI) → Router → Cardhost (Mock)"

### What Should Exist

According to [`docs/what-to-make.md:469-500`](docs/what-to-make.md:469-500):

```typescript
// E2E Test Example (from spec)
describe('Complete System Flow', () => {
  let router: RouterService;
  let cardhost: CardhostService;
  let controller: ControllerClient;

  beforeAll(async () => {
    // Start Router
    router = new RouterService({ port: 0 }); // random port
    await router.start();
    
    // Start Cardhost with mock platform
    const mockPlatform = new MockSmartCardPlatform();
    cardhost = new CardhostService(mockPlatform, { 
      routerUrl: router.url 
    });
    await cardhost.connect();
    
    // Create Controller client
    controller = new ControllerClient({
      routerUrl: router.url,
      token: 'test-token'
    });
  });

  it('should complete APDU send/receive flow', async () => {
    // Connect controller to cardhost
    await controller.connect(cardhost.uuid);
    
    // Send APDU via jsapdu-interface
    const command = new CommandApdu(0x00, 0xA4, 0x04, 0x00, 
      new Uint8Array([0xA0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]));
    
    const response = await controller.transmit(command);
    
    // Verify response
    expect(response).toBeInstanceOf(ResponseApdu);
    expect(response.sw).toBe(0x9000);
  });
});
```

### Impact
- **Cannot verify system works** - tests pass but system is broken
- **Wasted development time** - tests don't catch real issues  
- **False confidence** - green tests mean nothing
- Violates test philosophy from spec Section 6.6

---

## 🔥 Critical Violation #4: Missing jsapdu Documentation

### What the Research Notes Say
[`docs/devnotes/research-jsapdu-joip.md:3-13`](docs/devnotes/research-jsapdu-joip.md:3-13):
> **⚠️ CRITICAL FOR AI AGENTS**: If you're reading this, you MUST clone the repositories and read the markdown files recursively.
>
> **🚨 CONSEQUENCE OF NOT CLONING**: Attempting to develop without reading the full documentation will result in:
> - **Code Corruption**: You will write incompatible implementations that break the abstraction layers
> - **Memory Leaks**: Resource disposal patterns are non-obvious; you'll create unclosed handles
> - **Protocol Violations**: APDU encoding edge cases will cause silent failures on real hardware

### What We Have
- ✅ Repositories are cloned in `research/`
- ❌ Implementation doesn't follow jsapdu patterns at all
- ❌ No use of `await using` for resource cleanup
- ❌ No proper abstraction layer following jsapdu architecture

### What Should Exist
From [`research/jsapdu/packages/interface/src/abstracts.ts`](research/jsapdu/packages/interface/src/abstracts.ts):

```typescript
// Correct resource management pattern (from jsapdu)
await using platform = await getPlatform();
await platform.init();

const devices = await platform.getDeviceInfo();
await using device = await platform.acquireDevice(devices[0].id);

await using card = await device.startSession();
const response = await card.transmit(command);
// Auto-cleanup via Symbol.asyncDispose
```

Current implementation has NONE of this.

---

## 📋 Rebuild Plan

### Phase 1: Foundation (Critical)
1. **Setup proper jsapdu-over-ip integration**
   - Add `@aokiapp/jsapdu-over-ip` dependency
   - Study `research/jsapdu-over-ip/` implementation
   - Create transport adapters if needed

2. **Design library-first architecture**
   - Create `lib/` and `runtime/` separation
   - Define clear library APIs
   - Export testable classes

### Phase 2: Core Implementation
3. **Implement Controller Library**
   - `ControllerClient` class wrapping `RemoteSmartCardPlatform`
   - Session management using jsapdu-over-ip transport
   - Proper resource cleanup with `await using`

4. **Implement Cardhost Library**
   - `CardhostService` class wrapping `SmartCardPlatformAdapter`
   - Integration with `PcscPlatform` (real) and `MockPlatform` (test)
   - Proper authentication and connection management

5. **Implement Router Library**
   - `RouterService` class for relay logic
   - Authentication manager (separate class)
   - Session relay manager (separate class)
   - Transport bridging (HTTP/WebSocket to jsapdu-over-ip)

### Phase 3: Runtime Wrappers
6. **Controller CLI** - thin wrapper around `ControllerClient`
7. **Cardhost Service** - thin wrapper around `CardhostService`  
8. **Router Server** - Hono server using `RouterService`

### Phase 4: Comprehensive Testing
9. **Unit Tests** - test each class in isolation
10. **Integration Tests** - test class interactions
11. **E2E Tests** - full system flow with mock platform

---

## Files to Delete (Complete Destruction Required)

### ❌ Delete These - They Are Fundamentally Wrong

```
packages/shared/src/crypto/           # jsapdu-over-ip handles this
packages/shared/src/protocol/         # jsapdu-over-ip handles this
packages/controller/src/lib.ts        # Wrong architecture
packages/cardhost/src/index.ts        # Wrong architecture
packages/router/src/index.ts          # Wrong architecture
tests/integration/                    # Meaningless tests
tests/e2e/                            # Doesn't test actual system
```

### ⚠️ Salvage These (Refactor Required)

```
packages/controller/src/commands/     # CLI logic OK, needs refactor
packages/controller/src/cli.ts        # OK but needs to use new lib/
tests/unit/crypto-*.test.ts          # Good tests, but for wrong code
```

---

## Success Criteria

The rebuild is complete when:

✅ **jsapdu-over-ip is used** - `RemoteSmartCardPlatform` and `SmartCardPlatformAdapter`  
✅ **Library-first architecture** - All components export testable library APIs  
✅ **Meaningful tests** - E2E tests run actual Controller → Router → Cardhost flow  
✅ **Resource cleanup** - Proper `await using` throughout  
✅ **Spec compliance** - Follows [`docs/what-to-make.md`](docs/what-to-make.md) exactly

---

## References

- Specification: [`docs/what-to-make.md`](docs/what-to-make.md)
- jsapdu Research: [`docs/devnotes/research-jsapdu-joip.md`](docs/devnotes/research-jsapdu-joip.md)
- jsapdu Source: `research/jsapdu/`
- jsapdu-over-ip Source: `research/jsapdu-over-ip/`

---

**BOTTOM LINE**: This is not fixable with incremental changes. The architecture is fundamentally wrong. We must start from scratch following the specification and using the correct libraries.