# API Specification: Remote APDU Communication System

## Overview

This document specifies all REST API and WebSocket endpoints for the Remote APDU Communication System, including authentication, request/response formats, and error handling.

---

## 1. REST API Endpoints

### 1.1 Cardhost Management

#### GET /cardhosts

List all registered Cardhosts and their connection status.

**Authentication**: Bearer token (optional)

**Response** (200 OK):

```json
[
  {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "connected": true
  },
  {
    "uuid": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "connected": false
  }
]
```

**Error Responses**:

- `401 Unauthorized`: Invalid or missing bearer token
- `500 Internal Server Error`: Server error

---

### 1.2 Controller Authentication

#### POST /controller/connect

Authenticate Controller with bearer token and issue session token.

**Request**:

```http
POST /controller/connect HTTP/1.1
Authorization: Bearer <bearer-token>
Content-Type: application/json
```

**Response** (201 Created):

```json
{
  "token": "sess_abcdef1234567890",
  "expiresAt": "2025-12-08T19:49:02.730Z"
}
```

**Error Responses**:

- `400 Bad Request`: Missing Authorization header
- `401 Unauthorized`: Invalid bearer token or insufficient length (< 10 chars)
- `500 Internal Server Error`: Server error

**Notes**:

- Bearer tokens must be at least 10 characters long
- Session tokens expire after 1 hour
- Session token should be used in subsequent WebSocket and session requests

---

### 1.3 Cardhost Authentication

#### POST /cardhost/connect

Request authentication challenge from Router.

**Request**:

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "<ed25519-public-key-spki-base64>"
}
```

**Response** (201 Created):

```json
{
  "challenge": "<random-base64-challenge>"
}
```

**Error Responses**:

- `400 Bad Request`: Missing uuid or publicKey
- `500 Internal Server Error`: Server error

**Notes**:

- Public key must be in SPKI format, base64-encoded
- Challenge is valid for 5 minutes
- Cardhost must sign this challenge and send it back via POST /cardhost/verify

---

#### POST /cardhost/verify

Verify Cardhost signature and complete authentication.

**Request**:

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "publicKey": "<ed25519-public-key-spki-base64>",
  "signature": "<detached-signature-base64>",
  "challenge": "<original-challenge>"
}
```

**Response** (200 OK):

```json
{
  "ok": true
}
```

**Error Responses**:

- `400 Bad Request`: Missing fields or expired challenge
- `401 Unauthorized`: Invalid signature
- `500 Internal Server Error`: Server error

**Notes**:

- Signature must be a valid Ed25519 detached signature over the challenge
- Challenge must match what was issued in POST /cardhost/connect
- Challenge expires 5 minutes after issue

---

### 1.4 Session Management

#### POST /sessions

Create a relay session between Controller and Cardhost.

**Request**:

```http
POST /sessions HTTP/1.1
x-session-token: sess_abcdef1234567890
Content-Type: application/json

{
  "cardhostUuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response** (201 Created):

```json
{
  "relayId": "<relay-session-id>"
}
```

**Error Responses**:

- `400 Bad Request`: Missing cardhostUuid
- `401 Unauthorized`: Invalid or expired session token
- `404 Not Found`: Cardhost not found or offline
- `500 Internal Server Error`: Server error

**Notes**:

- Session token must be obtained from POST /controller/connect
- Cardhost must be online (connected to Router)
- relayId is used to identify the relay for WebSocket connections

---

## 2. WebSocket API

### 2.1 Connection

**URL**: `wss://router.example.com/ws/session`

**Headers**:

```
x-session-token: sess_abcdef1234567890
```

**Connection Flow**:

1. Client connects to WebSocket with valid session token
2. Router opens connection and starts heartbeat (every 30 seconds)
3. Client receives heartbeat messages
4. Client can send/receive encrypted or other message types

---

### 2.2 Message Format

All WebSocket messages use an envelope format:

```typescript
interface WsEnvelope<T = unknown> {
  type: "apdu.command" | "apdu.response" | "encrypted" | "heartbeat" | "error";
  payload: T;
  seq?: number; // Monotonic sequence number
  ts?: string; // ISO8601 timestamp
}
```

---

### 2.3 Message Types

#### Heartbeat

Sent by Router every 30 seconds. Client may ignore or send pong.

**From Router**:

```json
{
  "type": "heartbeat",
  "payload": {
    "ping": 1733689742730
  },
  "ts": "2025-12-08T19:49:02.730Z"
}
```

#### APDU Command (Encrypted)

Controller sends APDU command encrypted.

**From Controller**:

```json
{
  "type": "encrypted",
  "payload": {
    "iv": "<base64-iv>",
    "ciphertext": "<base64-encrypted-apdu>",
    "authTag": "<base64-auth-tag>",
    "senderPublicKey": "<ephemeral-public-key>"
  },
  "seq": 1,
  "ts": "2025-12-08T19:49:02.730Z"
}
```

**Inner plaintext** (decrypted by Cardhost):

```json
{
  "hex": "00A4040008A000000003000000"
}
```

#### APDU Response (Encrypted)

Cardhost sends APDU response encrypted.

**From Cardhost**:

```json
{
  "type": "encrypted",
  "payload": {
    "iv": "<base64-iv>",
    "ciphertext": "<base64-encrypted-response>",
    "authTag": "<base64-auth-tag>",
    "senderPublicKey": "<ephemeral-public-key>"
  },
  "seq": 2,
  "ts": "2025-12-08T19:49:02.731Z"
}
```

**Inner plaintext** (decrypted by Controller):

```json
{
  "dataHex": "A4",
  "sw": "9000"
}
```

#### Error

Router sends error message on failures.

**From Router**:

```json
{
  "type": "error",
  "payload": {
    "code": "CARDHOST_OFFLINE",
    "message": "Cardhost disconnected unexpectedly"
  },
  "ts": "2025-12-08T19:49:02.730Z"
}
```

---

## 3. Error Handling

### Error Response Format

All error responses follow this format:

```json
{
  "error": "<error-code>",
  "message": "<human-readable-message>",
  "details": {}
}
```

### HTTP Status Codes

| Status | Meaning             | Common Causes                        |
| ------ | ------------------- | ------------------------------------ |
| 200    | OK                  | Successful request                   |
| 201    | Created             | Successful resource creation         |
| 400    | Bad Request         | Malformed request, missing fields    |
| 401    | Unauthorized        | Invalid credentials or expired token |
| 403    | Forbidden           | Insufficient permissions             |
| 404    | Not Found           | Resource not found                   |
| 408    | Request Timeout     | Request took too long                |
| 409    | Conflict            | Resource already exists              |
| 500    | Server Error        | Unexpected server error              |
| 502    | Bad Gateway         | Service unavailable                  |
| 503    | Service Unavailable | Server overloaded or maintenance     |

### WebSocket Close Codes

| Code | Meaning          |
| ---- | ---------------- |
| 1000 | Normal closure   |
| 1001 | Going away       |
| 1002 | Protocol error   |
| 1003 | Unsupported data |
| 1008 | Policy violation |
| 1011 | Server error     |

---

## 4. Authentication Details

### Bearer Token Format

Bearer tokens are opaque strings. Implementations may use:

- JWT tokens
- UUIDs
- Random cryptographic strings

**Header**:

```
Authorization: Bearer <token>
```

### Session Token Lifecycle

1. **Issued**: POST /controller/connect (valid for 1 hour)
2. **Used**: WebSocket header `x-session-token`, REST header, or query parameter
3. **Expired**: Automatically invalidated after expiration time
4. **Refresh**: Client must re-authenticate with POST /controller/connect

---

## 5. Rate Limiting

**Recommended Limits**:

- 100 requests/minute per IP (general API)
- 1000 messages/minute per WebSocket session (APDU relay)

**Response Headers**:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1733689800
```

---

## 6. Encryption Details

### Session Key Derivation

1. **ECDH**: Compute shared secret using X25519 or P-256
2. **HKDF**: Derive session key using HKDF-SHA256
   ```
   sessionKey = HKDF-SHA256(
     input_key_material: shared_secret,
     salt: random_salt,
     info: "remote-apdu-session",
     length: 32
   )
   ```

### Message Encryption

- **Algorithm**: AES-256-GCM
- **IV Length**: 12 bytes
- **Auth Tag Length**: 16 bytes
- **Key Length**: 32 bytes (256-bit)

### Message Authentication

All critical messages must include a detached signature:

- **Algorithm**: Ed25519 or ECDSA-P256
- **Format**: Base64-encoded signature over canonicalized JSON payload

---

## 7. Example Flows

### Complete APDU Send Flow

```
1. Controller: POST /controller/connect
   Request: { Authorization: "Bearer token123" }
   Response: { token: "sess_xyz", expiresAt: "..." }

2. Controller: POST /sessions
   Request: { cardhostUuid: "...", header: "x-session-token: sess_xyz" }
   Response: { relayId: "relay_abc" }

3. Controller: WebSocket Connect wss://router/ws/session
   Header: x-session-token: sess_xyz

4. Controller: Send Encrypted APDU
   Message: { type: "encrypted", payload: {...}, seq: 1 }

5. Router: Relay to Cardhost (same payload)

6. Cardhost: Decrypt and Execute APDU

7. Cardhost: Send Encrypted Response
   Message: { type: "encrypted", payload: {...}, seq: 1 }

8. Router: Relay to Controller

9. Controller: Decrypt Response
   Message received with dataHex and sw fields
```

---

## 8. Monitoring Endpoints

### Cardhost Monitor

**URL**: `http://localhost:8001/monitor`

#### GET /monitor/status

Get Cardhost status.

**Response** (200 OK):

```json
{
  "isRunning": true,
  "isConnected": true,
  "cardInserted": true,
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "metrics": {
    "uptime": 3600,
    "apdusSent": 150,
    "apdusReceived": 150,
    "errorCount": 0,
    "lastActivityAt": "2025-12-08T19:49:02.730Z",
    "cpuUsage": 0.15,
    "memoryUsage": 52428800
  },
  "sessionCount": 1
}
```

#### GET /monitor/logs

Get recent logs.

**Response** (200 OK):

```json
{
  "logs": ["[2025-12-08T19:49:02.730Z] [INFO] Connected to Router", "[2025-12-08T19:49:03.500Z] [INFO] APDU sent: 00A4040008A000000003000000"],
  "total": 150
}
```

#### GET /monitor/ui

Get monitoring web UI (HTML).

---

## 9. Best Practices

1. **Token Management**:
   - Always use HTTPS/WSS in production
   - Store tokens securely (environment variables, secure storage)
   - Refresh tokens before expiration
   - Never log tokens

2. **Error Handling**:
   - Implement exponential backoff for retries
   - Set appropriate timeouts (30s for HTTP, 60s for WebSocket)
   - Log errors with request IDs for debugging

3. **Security**:
   - Validate all input (UUIDs, hex strings, JSON)
   - Use TLS for all connections
   - Implement rate limiting
   - Monitor for suspicious activity

4. **Reliability**:
   - Implement automatic reconnection with backoff
   - Buffer messages during disconnection
   - Use sequence numbers to detect message loss
   - Implement heartbeat detection

---

## Appendix: OpenAPI 3.0 Specification

See [openapi.yaml](./openapi.yaml) for full OpenAPI specification.
