# STEP 0 Summary — Repository Study and Contract Mapping

Date: 2025-12-09

Purpose: Evidence of complete understanding prior to any implementation work (Gate A)

Explicit Statement: RPC と暗号は分離（Router は暗号文の透過中継）

---

## Completed Actions

- Verified and updated research repositories
  - research/jsapdu (git pull)
  - research/jsapdu-over-ip (git pull)
- Read core documentation and source recursively (see list below)
- Studied abstractions for SmartCardPlatform and jsapdu-over-ip transport contracts
- Validated that jsapdu-over-ip provides RPC serialization only, not encryption

---

## Files Read (Primary)

- jsapdu documentation and internals
  - [docs/README.md](research/jsapdu/docs/README.md)
  - [docs/architecture/package-interactions.md](research/jsapdu/docs/architecture/package-interactions.md)
  - [packages/interface/src/abstracts.ts](research/jsapdu/packages/interface/src/abstracts.ts)
  - [packages/interface/docs/extended-apdu.md](research/jsapdu/packages/interface/docs/extended-apdu.md)
  - [packages/pcsc/docs/async-mutex.md](research/jsapdu/packages/pcsc/docs/async-mutex.md)
  - [packages/mynacard/docs/tlv-schemas.md](research/jsapdu/packages/mynacard/docs/tlv-schemas.md)

- jsapdu-over-ip (joip) transport and proxies
  - [README.md](research/jsapdu-over-ip/README.md)
  - [src/client/platform-proxy.ts](research/jsapdu-over-ip/src/client/platform-proxy.ts)
  - [src/server/platform-adapter.ts](research/jsapdu-over-ip/src/server/platform-adapter.ts)
  - [src/transport.ts](research/jsapdu-over-ip/src/transport.ts)

- Project-local context (for cross-reference only)
  - [docs/devnotes/HANDOFF-PACKAGE.md](docs/devnotes/HANDOFF-PACKAGE.md)
  - [docs/devnotes/research-jsapdu-joip.md](docs/devnotes/research-jsapdu-joip.md)
  - [docs/devnotes/REQUIREMENTS-COMPLIANCE-ANALYSIS.md](docs/devnotes/REQUIREMENTS-COMPLIANCE-ANALYSIS.md)
  - [docs/devnotes/CODE-QUALITY-REVIEW-COMPLETE.md](docs/devnotes/CODE-QUALITY-REVIEW-COMPLETE.md)
  - [docs/what-to-make.md](docs/what-to-make.md)

---

## Contract Mapping (with line references)

Abstractions (jsapdu):

- Platform initialization
  - [TypeScript.SmartCardPlatform.init()](research/jsapdu/packages/interface/src/abstracts.ts:38)
- Device session establishment
  - [TypeScript.SmartCardDevice.startSession()](research/jsapdu/packages/interface/src/abstracts.ts:288)

Transport contracts (jsapdu-over-ip):

- Client-side transport interface
  - [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14)
- Server-side transport interface
  - [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)
- Client-side platform proxy (Remote)
  - [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93)
- Server-side platform adapter
  - [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32)

Serialization and APDU details:

- Extended APDU encoding rules and detection thresholds
  - [TypeScript.Extended APDU Support](research/jsapdu/packages/interface/docs/extended-apdu.md:1)

Concurrency pattern (PC/SC):

- Async mutex pattern to serialize access:
  - [TypeScript.AsyncMutex](research/jsapdu/packages/pcsc/docs/async-mutex.md:8)

TLV parsing pattern (MynaCard):

- TLV schema architecture and decoders:
  - [TypeScript.MynaCard TLV Schemas](research/jsapdu/packages/mynacard/docs/tlv-schemas.md:1)

---

## Key Takeaways

- Role of jsapdu-over-ip
  - Provides transport-agnostic RPC serialization of SmartCardPlatform
  - Does not implement encryption, signatures, or key exchange
- Architectural layering is strict and correct
  - App ↔ jsapdu-interface ↔ platform impl (PC/SC, RN) ↔ native/FFI
  - joip adds RPC by mirroring jsapdu-interface over an injected transport
- Resource management pattern is critical
  - Proper use of `await using` and async disposal semantics across Platform/Device/Card lifecycles
- Error propagation is layered
  - Native → FFI mapping → interface errors → platform/application wrapping
- Extended APDU handling is non-trivial
  - Automatic selection of standard vs extended formats with specific length markers and edge cases

---

## Clarification: RPC and Crypto Separation

- RPC と暗号は分離（Router は暗号文の透過中継）
  - jsapdu-over-ip = RPC serialization/proxying only
  - E2E encryption/signatures required separately (ECDH→HKDF→AES-GCM + Ed25519)
  - Router must relay opaque ciphertext, never decrypt

---

## JoIP Data Flow (Conceptual)

- Controller
  - Uses [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93) to issue jsapdu-interface calls over [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14)
- Router
  - Accepts RPC requests, authenticates, and relays via session linkage
- Cardhost
  - Hosts actual platform, exported via [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32) over [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)

---

## Evidence of Understanding (Examples)

- Platform lifecycle enforcement via assertions:
  - [TypeScript.SmartCardPlatform.assertNotInitialized()](research/jsapdu/packages/interface/src/abstracts.ts:67)
  - [TypeScript.SmartCardPlatform.assertInitialized()](research/jsapdu/packages/interface/src/abstracts.ts:57)
- Device acquisition and session pattern enforced by Remote proxies:
  - [TypeScript.RemoteSmartCardPlatform.acquireDevice()](research/jsapdu-over-ip/src/client/platform-proxy.ts:172)
- Server adapter faithfully mirrors interface methods and serializes results/errors:
  - [TypeScript.SmartCardPlatformAdapter.dispatch()](research/jsapdu-over-ip/src/server/platform-adapter.ts:79)

---

## Conclusion

- Step 0 complete with traceable evidence and contract mapping
- Architecture and contracts are fully understood and referenced with exact lines
- Ready to proceed to Gate B (DESIGN-NOTES-P0.md) and then implementation phases under the stated guardrails
