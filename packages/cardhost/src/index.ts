/**
 * Cardhost Service
 * Manages physical card reader, connects to Router, relays APDU operations.
 * Spec: docs/what-to-make.md (Section 3.2)
 */

import { WebSocket } from 'ws';
import { fetch } from 'undici';
import { webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  generateEd25519KeyPairBase64,
  signJsonEd25519,
  verifyJsonEd25519,
  generateX25519KeyPairBase64,
  computeSharedSecretX25519,
  encryptAesGcm,
  decryptAesGcm,
  deriveSessionKey,
  canonicalizeJson
} from '@remote-apdu/shared';
import type { SignedMessage, EncryptedMessage, ApduCommand, ApduResponse, WsEnvelope } from '@remote-apdu/shared';

interface CardHostConfig {
  routerUrl: string;
  uuid: string;
  signingPublicKey: string;
  signingPrivateKey: string;
}

interface SessionState {
  sessionId: string;
  controllerEphemeralPublicKey: string;
  cardHostEphemeralPrivateKey: string;
  cardHostEphemeralPublicKey: string;
  sessionKey: Uint8Array;
  seqNumber: number;
}

const CONFIG_DIR = join(homedir(), '.cardhost');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  // RFC 4122 v4 variant
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    // eslint-disable-next-line no-console
    console.info(`Creating config directory: ${CONFIG_DIR}`);
  }
}

async function loadOrCreateConfig(): Promise<CardHostConfig> {
  ensureConfigDir();

  if (existsSync(CONFIG_FILE)) {
    const content = readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(content) as CardHostConfig;
  }

  // Generate new keypair and UUID
  const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = await generateEd25519KeyPairBase64();
  const uuid = generateUuidV4();

  const config: CardHostConfig = {
    routerUrl: process.env.ROUTER_URL || 'https://router.example.com',
    uuid,
    signingPublicKey: publicKeySpkiBase64,
    signingPrivateKey: privateKeyPkcs8Base64
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  // eslint-disable-next-line no-console
  console.info(`Config created at ${CONFIG_FILE}, UUID: ${uuid}`);
  return config;
}

class CardHostService {
  private config: CardHostConfig;
  private ws: WebSocket | null = null;
  private sessions: Map<string, SessionState> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000;

  constructor(config: CardHostConfig) {
    this.config = config;
  }

  static async create(): Promise<CardHostService> {
    const config = await loadOrCreateConfig();
    return new CardHostService(config);
  }

  async connect(): Promise<void> {
    try {
      // Step 1: POST /cardhost/connect with public key
      const connectPayload = {
        uuid: this.config.uuid,
        publicKey: this.config.signingPublicKey
      };

      const connectRes = await fetch(`${this.config.routerUrl}/cardhost/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(connectPayload)
      });

      if (!connectRes.ok) {
        throw new Error(`Connect failed: ${connectRes.status} ${connectRes.statusText}`);
      }

      const { challenge } = (await connectRes.json()) as { challenge: string };

      // Step 2: Sign challenge
      const signatureBase64 = await signJsonEd25519(challenge, this.config.signingPrivateKey);

      // Step 3: POST /cardhost/verify with signature
      const verifyPayload = {
        uuid: this.config.uuid,
        publicKey: this.config.signingPublicKey,
        signature: signatureBase64,
        challenge
      };

      const verifyRes = await fetch(`${this.config.routerUrl}/cardhost/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyPayload)
      });

      if (!verifyRes.ok) {
        throw new Error(`Verify failed: ${verifyRes.status} ${verifyRes.statusText}`);
      }

      // Step 4: Upgrade to WebSocket
      const wsUrl = this.config.routerUrl.replace(/^https?:/, 'wss:').replace(/\/$/, '');
      this.ws = new WebSocket(`${wsUrl}/ws/session`);

      this.ws.on('open', () => this.onWebSocketOpen());
      this.ws.on('message', async (data) => this.onWebSocketMessage(data));
      this.ws.on('close', () => this.onWebSocketClose());
      this.ws.on('error', (err) => this.onWebSocketError(err));

      this.reconnectAttempts = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Connection failed:', (err as Error).message);
      this.scheduleReconnect();
    }
  }

  private onWebSocketOpen(): void {
    // eslint-disable-next-line no-console
    console.info('Connected to Router');
  }

  private async onWebSocketMessage(data: unknown): Promise<void> {
    try {
      const envelope = JSON.parse(data as string) as WsEnvelope;

      if (envelope.type === 'heartbeat') {
        // Respond with pong
        this.sendEnvelope({ type: 'heartbeat', payload: { pong: Date.now() } });
        return;
      }

      if (envelope.type === 'encrypted') {
        await this.handleEncryptedMessage(envelope.payload as EncryptedMessage);
        return;
      }

      // Handle other message types
      // eslint-disable-next-line no-console
      console.debug('Received message:', envelope.type);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Message handling error:', (err as Error).message);
    }
  }

  private async handleEncryptedMessage(encrypted: EncryptedMessage): Promise<void> {
    try {
      // Find session by sender public key
      let sessionState: SessionState | undefined;
      for (const session of this.sessions.values()) {
        if (session.controllerEphemeralPublicKey === encrypted.senderPublicKey) {
          sessionState = session;
          break;
        }
      }

      if (!sessionState) {
        // eslint-disable-next-line no-console
        console.error('No matching session for encrypted message');
        return;
      }

      const plaintext = await decryptAesGcm(encrypted, sessionState.sessionKey);
      const payload = JSON.parse(Buffer.from(plaintext).toString('utf8')) as ApduCommand;

      // Execute APDU command (stub - would use jsapdu-over-ip in real impl)
      await this.executeApdu(payload.hex, sessionState);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Decryption or APDU execution failed:', (err as Error).message);
    }
  }

  private async executeApdu(hex: string, sessionState: SessionState): Promise<void> {
    try {
      // Stub implementation: mock card response
      const response: ApduResponse = {
        dataHex: '',
        sw: '9000' // Success
      };

      // Encrypt response
      const plaintext = new Uint8Array(Buffer.from(JSON.stringify(response), 'utf8'));
      const encrypted = await encryptAesGcm(plaintext, sessionState.sessionKey);

      const message: EncryptedMessage = {
        ...encrypted,
        senderPublicKey: sessionState.cardHostEphemeralPublicKey
      };

      this.sendEnvelope({
        type: 'encrypted',
        payload: message,
        seq: ++sessionState.seqNumber,
        ts: new Date().toISOString()
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('APDU execution error:', (err as Error).message);
    }
  }

  private onWebSocketClose(): void {
    // eslint-disable-next-line no-console
    console.info('Disconnected from Router');
    this.scheduleReconnect();
  }

  private onWebSocketError(err: Error): void {
    // eslint-disable-next-line no-console
    console.error('WebSocket error:', err.message);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // eslint-disable-next-line no-console
      console.error('Max reconnection attempts reached');
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    // eslint-disable-next-line no-console
    console.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => this.connect(), delay);
  }

  private sendEnvelope(envelope: WsEnvelope): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }
}

// Main entry point
async function main(): Promise<void> {
  const service = await CardHostService.create();
  await service.connect();

  // Graceful shutdown
  process.on('SIGINT', () => {
    // eslint-disable-next-line no-console
    console.info('Shutting down Cardhost...');
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
