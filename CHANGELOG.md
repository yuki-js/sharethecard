# Changelog

## 0.2.0 - 2025-12-14

### Overview
Environment-agnostic refactor of `@remote-apdu/shared` and consolidation of Node-only functionality into package-local modules. Unused or single-module-only exports were removed. All tests and bash integration tests pass after refactor.

### Breaking changes
- Removed Node-only WebSocket framework from shared:
  - Shared now only re-exports types and environment-agnostic utils: [packages/shared/src/index.ts](packages/shared/src/index.ts)
  - All `ws`-based helpers were moved to controller/cardhost local modules.
- Pruned environment-specific and single-module-only exports from shared:
  - Removed UUID helpers: [packages/shared/src/utils/index.ts](packages/shared/src/utils/index.ts)
  - Removed random helper (moved to router-local): [packages/shared/src/utils/index.ts](packages/shared/src/utils/index.ts)
  - Removed Ed25519 helpers (moved to controller-local): [packages/shared/src/utils/encoding.ts](packages/shared/src/utils/encoding.ts)
- Router-only types moved out of shared:
  - Replaced shared types with router-local: [packages/router/src/shared/types.ts](packages/router/src/shared/types.ts)
  - Updated router imports and re-exports accordingly: [packages/router/src/index.ts](packages/router/src/index.ts), [packages/router/src/router.ts](packages/router/src/router.ts)

### Added
- Controller-local WebSocket helpers for Node (`ws`):
  - [packages/controller/src/lib/ws.ts](packages/controller/src/lib/ws.ts)
- Cardhost-local WebSocket helpers for Node (`ws`):
  - [packages/cardhost/src/lib/ws.ts](packages/cardhost/src/lib/ws.ts)
- Controller-local hex utilities:
  - [packages/controller/src/lib/hex.ts](packages/controller/src/lib/hex.ts)
- Router-local random helper:
  - [packages/router/src/shared/random.ts](packages/router/src/shared/random.ts)
- Controller-local Ed25519 export helper:
  - [packages/controller/src/lib/crypto-utils.ts](packages/controller/src/lib/crypto-utils.ts)
- Unit test coverage for shared environment-agnostic utilities:
  - [tests/unit/shared-utils.test.ts](tests/unit/shared-utils.test.ts)

### Changed
- Controller/Cardhost transport import updates to use local ws helpers:
  - Controller RouterTransport: [packages/controller/src/lib/router-transport.ts](packages/controller/src/lib/router-transport.ts)
  - Cardhost RouterTransport: [packages/cardhost/src/lib/router-transport.ts](packages/cardhost/src/lib/router-transport.ts)
- Controller CLI commands now use controller-local APDU parsing:
  - [packages/controller/src/commands/send.ts](packages/controller/src/commands/send.ts)
  - [packages/controller/src/commands/script.ts](packages/controller/src/commands/script.ts)
  - [packages/controller/src/commands/interactive.ts](packages/controller/src/commands/interactive.ts)
- Router services now use router-local random helper:
  - [packages/router/src/service/auth-service.ts](packages/router/src/service/auth-service.ts)
  - [packages/router/src/service/controller-auth-service.ts](packages/router/src/service/controller-auth-service.ts)
  - [packages/router/src/service/session-service.ts](packages/router/src/service/session-service.ts)
- Controller KeyManager now uses controller-local Ed25519 export:
  - [packages/controller/src/lib/key-manager.ts](packages/controller/src/lib/key-manager.ts)
- Test runner configuration updated to include top-level unit tests:
  - [vitest.config.ts](vitest.config.ts)

### Removed
- From shared utils:
  - `generateUuidV4`, `isValidUuid`: [packages/shared/src/utils/index.ts](packages/shared/src/utils/index.ts)
  - `generateRandomBase64` (moved to router-local): [packages/shared/src/utils/index.ts](packages/shared/src/utils/index.ts)
- From shared encoding:
  - `importEd25519Key`, `exportEd25519KeyPair`: [packages/shared/src/utils/encoding.ts](packages/shared/src/utils/encoding.ts)
- From shared types (moved to router-local):
  - `SessionToken`, `CardhostInfo`, `RouterConfig`: [packages/shared/src/types/index.ts](packages/shared/src/types/index.ts)

### Migration notes
- If you previously imported the shared WebSocket framework or helpers from `@remote-apdu/shared`, use the new local modules:
  - Controller: [packages/controller/src/lib/ws.ts](packages/controller/src/lib/ws.ts)
  - Cardhost: [packages/cardhost/src/lib/ws.ts](packages/cardhost/src/lib/ws.ts)
- Replace shared hex helpers with controller-local [packages/controller/src/lib/hex.ts](packages/controller/src/lib/hex.ts)
- Replace shared `generateRandomBase64()` with router-local [packages/router/src/shared/random.ts](packages/router/src/shared/random.ts)
- Replace shared `exportEd25519KeyPair()` with controller-local [packages/controller/src/lib/crypto-utils.ts](packages/controller/src/lib/crypto-utils.ts)
- Router consumers should import types from: [packages/router/src/shared/types.ts](packages/router/src/shared/types.ts)

### Tooling / configuration
- TypeScript monorepo scope refined to packages only (excluded `research/**`, tests under packages still included):
  - [tsconfig.base.json](tsconfig.base.json)
- Fixed test inclusion patterns for Vitest to ensure top-level tests are discovered:
  - [vitest.config.ts](vitest.config.ts)
