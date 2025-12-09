# DESIGN-NOTES-P0 — WebSocket RPC Relay and E2E Crypto Plan

Date: 2025-12-09

Gate B artifact. One-page design memo prior to P0 implementation.

Explicit Boundary: RPC と暗号は分離（Router は暗号文の透過中継）

---

## Scope (P0)

- Implement WebSocket RPC relay on Router
  - Endpoint: `/api/jsapdu/ws`
  - Roles/headers: `x-role`, `x-cardhost-uuid`, `x-session-token`
  - Connection pool and message routing
  - Replace placeholder at [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180)

- Prepare E2E crypto layer design (implementation in P0 roadmap, separate PRs)
  - ECDH → HKDF → AES-GCM
  - Ed25519 message signatures
  - Nonce/sequence/replay policies
  - Router relays ciphertext only (opaque payloads)

---

## Architecture — Current vs Target

- Controller
  - Issues jsapdu-interface RPC via HTTP to Router
  - Uses Remote platform proxy [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93) over a [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14)

- Router
  - Auth via REST
  - RPC relay via:
    - HTTP ingress from Controller: [packages/router/src/runtime/server.ts](packages/router/src/runtime/server.ts:149)
    - WebSocket to Cardhost: New `/api/jsapdu/ws` endpoint
    - Session coordination via [TypeScript.SessionRelay](packages/router/src/lib/relay/session-relay.ts:32)

- Cardhost
  - Hosts actual SmartCardPlatform (pcsc/rn/mock)
  - Exposes via JoIP server adapter [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32)
  - Receives RPC over WS using Router transport [packages/cardhost/src/lib/router-transport.ts](packages/cardhost/src/lib/router-transport.ts:20)

---

## WebSocket RPC Relay — Design

### Endpoint and Handshake

- Path: `/api/jsapdu/ws`
- Headers:
  - `x-role`: `controller` | `cardhost`
  - Controller-only: `x-session-token`
    - Validate using [TypeScript.RouterService.getControllerAuth()](packages/router/src/lib/router-service.ts:171) → `validateSession()`
  - Cardhost-only: `x-cardhost-uuid`
    - Must be registered and authenticated via REST challenge flow using [TypeScript.RouterService.getCardhostAuth()](packages/router/src/lib/router-service.ts:176)

- Upgrade handling (Node server side)
  - Attach `server.on('upgrade', ...)` and gate by path `/api/jsapdu/ws`
  - Accept and create a `WebSocket` per connection
  - Register the connection in SessionRelay with:
    - role = `controller` | `cardhost`
    - identifier = sessionToken (controller) or uuid (cardhost)
    - send = `ws.send(JSON.stringify(...))`
    - onMessage = per-envelope dispatcher

Files touched:

- [packages/router/src/runtime/server.ts](packages/router/src/runtime/server.ts) — add upgrade handler
- [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts) — augment internal routing

### Message Envelopes

- Controller → Router (HTTP or WS; initial design keeps HTTP):
  - `rpc-request`: `{ type: 'rpc-request', payload: RpcRequest }`

- Router → Cardhost (WS):
  - `rpc-request` forwarded to corresponding cardhost connection by `send()`

- Cardhost → Router (WS):
  - `rpc-response`: `{ type: 'rpc-response', payload: RpcResponse }`
  - `rpc-event`: `{ type: 'rpc-event', payload: RpcEvent }` (future)

- Router → Controller:
  - In current HTTP-bridge design, Router resolves the pending HTTP call with `RpcResponse`
  - If/when Controller WS is added, Router may forward `rpc-response` via controller WS `send()`

### SessionRelay Changes

Replace placeholder in [TypeScript.SessionRelay.relayToCardhost()](packages/router/src/lib/relay/session-relay.ts:136):

- Maintain pending map for in-flight requests:
  - `pending: Map<string, { resolve: (resp: RpcResponse) => void, reject: (err: Error) => void, timeout: NodeJS.Timeout }>`
- `relayToCardhost(sessionToken, request)`:
  1. Resolve relay session (controller sessionToken → cardhostUuid)
  2. Lookup cardhost connection; if missing → `CARDHOST_OFFLINE`
  3. Insert into `pending` with timeout (e.g., 30s)
  4. Send envelope to cardhost via `connection.send({ type: 'rpc-request', payload: request })`
  5. Return a Promise resolved by `relayToController(...)` when response arrives

- `relayToController(cardhostUuid, response)`:
  1. Resolve relay session (cardhostUuid → controller sessionToken)
  2. If controller WS not present, resolve the pending promise directly (bridge back to HTTP)
  3. If controller WS exists, forward via `controllerConn.send(response)` (future)

- Backpressure and clean-up:
  - On WS close, unregister connection via `unregisterController()` / `unregisterCardhost()`
  - On timeouts, reject pending and remove entries

### Router HTTP Bridge

[packages/router/src/runtime/server.ts](packages/router/src/runtime/server.ts:149-178):

- Handler already accepts `RpcRequest` via POST `/api/jsapdu/rpc`
- Implementation change (no API change): call `relay.relayToCardhost(sessionToken, request)` which now returns a Promise of `RpcResponse` instead of placeholder
- Return the resolved `RpcResponse` to the HTTP client

### Validation/Authorization Rules

- Controller WS:
  - Validate `x-session-token` via [TypeScript.ControllerAuth.validateSession()](packages/router/src/lib/auth/controller-auth.ts:68)
- Cardhost WS:
  - Validate `x-cardhost-uuid` exists and `isConnected(uuid)===true` via [TypeScript.CardhostAuth.isConnected()](packages/router/src/lib/auth/cardhost-auth.ts:177)
- Enforce 1 active WS per identifier (replace/close previous or reject duplicate)

### Error & Timeout Policy

- Request timeout default: 30s (extract constant later)
- Error codes:
  - `NO_RELAY_SESSION`: Missing controller↔cardhost pairing
  - `CARDHOST_OFFLINE`: No active WS for cardhost
  - `TIMEOUT`: No response within deadline
  - `BAD_ENVELOPE`: Envelope type/shape invalid

---

## E2E Crypto Layer — Design (Around JoIP, Not Inside)

Principle: Router is a dumb relay of opaque ciphertext. JoIP remains pure RPC serialization ([TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14) / [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)).

New files:

- [packages/shared/src/crypto/e2e-encryption.ts](packages/shared/src/crypto/e2e-encryption.ts)
- [packages/controller/src/lib/e2e-wrapper.ts](packages/controller/src/lib/e2e-wrapper.ts)
- [packages/cardhost/src/lib/e2e-wrapper.ts](packages/cardhost/src/lib/e2e-wrapper.ts)

### Protocol Outline

- Key Exchange (Ephemeral ECDH)
  - Curve: P-256 (WebCrypto-supported)
  - Controller and Cardhost each generate ephemeral key pair
  - Exchange public keys via Router (authenticated channels)
- Key Derivation
  - HKDF(SHA-256) over ECDH shared secret
  - Derive:
    - `k_aes`: AES-256-GCM content encryption key
    - `k_sig`: Ed25519 signing key (or maintain cardhost’s existing Ed25519 for identity; controller generates an Ed25519 key for signatures)
- Message Format (encrypted APDU and control)
  ```json
  {
    "v": 1,
    "seq": 123, // Monotonic sequence number
    "iv": "base64(12 bytes)", // AES-GCM IV per message
    "ciphertext": "base64(...)", // AES-GCM ciphertext (includes tag)
    "senderPub": "base64(...)", // Ephemeral ECDH public key (or session ID)
    "sig": "base64(...)" // Ed25519 signature over canonical JSON of {v, seq, iv, ciphertext, senderPub}
  }
  ```
- Nonce/Sequence/Replay
  - 12-byte IV per message: random (or deterministic from seq via HKDF expand) — require uniqueness under key
  - `seq` enforced strictly monotonic per session on both ends
  - Maintain sliding window for acceptable `seq` and reject duplicates (replay protection)
- Signing
  - Ed25519 signatures over canonical JSON (shared canonicalizer)
  - Canonical JSON utility refactored to shared module (see QIP below)

- Router Behavior
  - No decryption; treat envelope as opaque JSON
  - Only validates session identity/authorization and relays message

- Integration Points
  - Controller side wraps JoIP `ClientTransport`:
    - On `call()`, encrypt and sign payload object; carry encrypted blob as `request.params[0]`
  - Cardhost side wraps JoIP `ServerTransport`:
    - On `onRequest()`, decrypt and verify before passing to platform adapter
    - On response, encrypt/sign back

---

## Placeholder Replacement Plan

Target: [TypeScript.SessionRelay.relayToCardhost()](packages/router/src/lib/relay/session-relay.ts:136) lines [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180)

Replace with:

- Lookup `cardhostConn`
- Register pending resolver by `request.id`
- `cardhostConn.send({ type: 'rpc-request', payload: request })`
- Return Promise resolved by `relayToController(...)`
- Add `onMessage` handler attachment on connection registration to process `rpc-response` and `rpc-event` envelopes

Also adjust [TypeScript.SessionRelay.relayToController()](packages/router/src/lib/relay/session-relay.ts:186):

- If controller WS exists → `controllerConn.send(response)`
- Else → resolve pending map promise (HTTP bridge path)

---

## WebSocket Handler Skeleton (Router)

Planned insertion in [packages/router/src/runtime/server.ts](packages/router/src/runtime/server.ts):

- Import `ws` and create a `WebSocketServer` with manual upgrade
- Gate path: `/api/jsapdu/ws`
- Header read/validation via RouterService getters
- Register connection with SessionRelay using role-specific identifiers
- Attach `message` listener → parse envelope → dispatch:
  - From cardhost: `rpc-response` → `relayToController(...)`
  - From controller (future): `rpc-request` events over WS

Note: Hono HTTP routes remain; upgrade handling uses the underlying Node server’s `upgrade` event.

---

## Error Flow

- Authentication failure
  - Controller WS: invalid/expired session → reject upgrade
  - Cardhost WS: uuid not authenticated via REST verify → reject upgrade
- Connection drop
  - Unregister link in SessionRelay; pending requests timeout
- Request timeout
  - Reject pending with `TIMEOUT`; HTTP caller receives error RpcResponse

---

## Test Plan (Incremental)

- Unit
  - SessionRelay
    - Pending map lifecycle (insert/resolve/timeout)
    - No relay session → `NO_RELAY_SESSION`
    - Cardhost offline → `CARDHOST_OFFLINE`

- Integration
  - Router HTTP `/api/jsapdu/rpc` ↔ Cardhost WS
    - Simulate cardhost WS that echos `rpc-response`
    - Assert HTTP call completes with proper `RpcResponse`

- E2E (future)
  - Controller HTTP + Cardhost WS + mock platform adapter
  - End-to-end APDU flow and error cases

---

## Quality Improvement Program (QIP) — P1/P2 Items to Start After Gate B

- Refactor duplicated code
  - Extract canonical JSON to shared utility:
    - From [packages/cardhost/src/lib/auth-manager.ts](packages/cardhost/src/lib/auth-manager.ts:113-133) and [packages/router/src/lib/auth/cardhost-auth.ts](packages/router/src/lib/auth/cardhost-auth.ts:152-172)
    - New: `packages/shared/src/utils/canonical-json.ts`
- Refactor hex parsing
  - Deduplicate logic in controller commands (send/interactive/script)
  - New: `packages/shared/src/utils/parse-hex.ts` or `packages/controller/src/lib/utils.ts`
- Add missing tests
  - SessionManager (8), AuthManager (8), Transports (6)
- Minor fixes
  - Replace private property bracket access (add getter) in [packages/cardhost/src/lib/cardhost-service.ts](packages/cardhost/src/lib/cardhost-service.ts:81)
  - Remove `console.error` in library code (propagate or inject logger)
  - Extract magic numbers to constants

---

## References (Contracts & Lines)

- Platform init: [TypeScript.SmartCardPlatform.init()](research/jsapdu/packages/interface/src/abstracts.ts:38)
- Device session: [TypeScript.SmartCardDevice.startSession()](research/jsapdu/packages/interface/src/abstracts.ts:288)
- JoIP transports: [TypeScript.ClientTransport](research/jsapdu-over-ip/src/transport.ts:14), [TypeScript.ServerTransport](research/jsapdu-over-ip/src/transport.ts:35)
- Remote proxy: [TypeScript.RemoteSmartCardPlatform](research/jsapdu-over-ip/src/client/platform-proxy.ts:93)
- Platform adapter: [TypeScript.SmartCardPlatformAdapter](research/jsapdu-over-ip/src/server/platform-adapter.ts:32)
- Router HTTP RPC ingress: [packages/router/src/runtime/server.ts](packages/router/src/runtime/server.ts:149-178)
- Relay placeholder to replace: [packages/router/src/lib/relay/session-relay.ts](packages/router/src/lib/relay/session-relay.ts:174-180)

---

Gate B complete — this memo explicitly defines the WebSocket relay design, the RPC–crypto separation, and the E2E crypto plan. Next action: apply QIP refactors and add tests, then implement the relay as per this design.
