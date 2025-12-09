/**
 * Protocol message types for Remote APDU Communication System.
 * This file follows the specification in docs/what-to-make.md section 4.3.
 */

export interface EncryptedMessage {
  /** Initialization Vector (Base64, recommended length: 12 bytes for AES-GCM) */
  iv: string;
  /** Encrypted payload (Base64) */
  ciphertext: string;
  /** Authentication tag (Base64) */
  authTag: string;
  /** Sender public key (Base64, curve depends on chosen ECDH) */
  senderPublicKey: string;
}

/**
 * Digital signature wrapper for important protocol messages.
 * `algorithm` examples: "Ed25519" or "ECDSA-P256".
 */
export interface SignedMessage<TPayload = unknown> {
  algorithm: 'Ed25519' | 'ECDSA-P256';
  /** Detached signature (Base64) over canonicalized payload bytes */
  signature: string;
  /** Canonicalized JSON payload for signature verification */
  payload: TPayload;
}

/**
 * APDU command from Controller to Cardhost.
 * Hex string without spaces, upper/lowercase tolerated, validated upstream.
 */
export interface ApduCommand {
  /** APDU command hex, e.g., "00A4040008A000000003000000" */
  hex: string;
}

/**
 * APDU response from Cardhost to Controller.
 */
export interface ApduResponse {
  /** Data field as hex string (may be empty) */
  dataHex: string;
  /** Status Word (SW) as 4-hex characters, e.g., "9000" */
  sw: string;
}

/**
 * Router-issued session token handed to Controller after bearer validation.
 */
export interface SessionToken {
  token: string;
  /** ISO8601 expiry */
  expiresAt: string;
}

/**
 * Generic envelope used over WebSocket when not using raw binary frames.
 * If E2E encryption is active, payload is EncryptedMessage and `type` reflects the inner message.
 */
export interface WsEnvelope<T = unknown> {
  type:
    | 'apdu.command'
    | 'apdu.response'
    | 'card.inserted'
    | 'card.removed'
    | 'heartbeat'
    | 'error'
    | 'encrypted';
  payload: T;
  /** Optional monotonic sequence to mitigate replay and aid ordering */
  seq?: number;
  /** Optional event timestamp (ISO8601) */
  ts?: string;
}