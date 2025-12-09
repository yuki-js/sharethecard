import chalk from 'chalk';
import { WebSocket } from 'ws';
import { fetch } from 'undici';
import { webcrypto } from 'node:crypto';
import {
  encryptAesGcm,
  decryptAesGcm,
  deriveSessionKey,
  generateX25519KeyPairBase64
} from '@remote-apdu/shared';
import type { EncryptedMessage, ApduResponse, WsEnvelope, SessionToken } from '@remote-apdu/shared';

export type ControllerSession = {
  sessionToken: string;
  cardhostUuid: string;
  relayId?: string;
  ws?: WebSocket;
  ephemeralPublicKey: string;
  ephemeralPrivateKey: string;
  sessionKey?: Uint8Array;
  seqNumber: number;
};

export function logVerbose(verbose: boolean | undefined, ...args: unknown[]) {
  if (verbose) {
    // eslint-disable-next-line no-console
    console.info(chalk.gray('[verbose]'), ...args);
  }
}

export function parseApduHexOrThrow(hex: string): Uint8Array {
  const cleaned = hex.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new Error('Invalid APDU hex format');
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function establishSession(
  routerUrl: string,
  cardhostUuid: string,
  token: string,
  verbose?: boolean
): Promise<ControllerSession> {
  logVerbose(verbose, 'Establishing session with Router');

  // Step 1: Connect to Router with bearer token
  const connectRes = await fetch(`${routerUrl}/controller/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
  });

  if (!connectRes.ok) {
    throw new Error(`Controller connect failed: ${connectRes.status} ${connectRes.statusText}`);
  }

  const sessionData = (await connectRes.json()) as SessionToken;
  logVerbose(verbose, 'Session token issued:', sessionData.token);

  // Step 2: Create relay session with Cardhost UUID
  const createSessionRes = await fetch(`${routerUrl}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionData.token
    },
    body: JSON.stringify({ cardhostUuid })
  });

  if (!createSessionRes.ok) {
    throw new Error(`Session creation failed: ${createSessionRes.status} ${createSessionRes.statusText}`);
  }

  const { relayId } = (await createSessionRes.json()) as { relayId: string };
  logVerbose(verbose, 'Relay established:', relayId);

  // Step 3: Generate ephemeral ECDH keypair for E2E encryption
  const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = await generateX25519KeyPairBase64();

  const session: ControllerSession = {
    sessionToken: sessionData.token,
    cardhostUuid,
    relayId,
    ephemeralPublicKey: publicKeySpkiBase64,
    ephemeralPrivateKey: privateKeyPkcs8Base64,
    seqNumber: 0
  };

  return session;
}

export async function upgradeToWebSocket(routerUrl: string, session: ControllerSession, verbose?: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = routerUrl.replace(/^https?:/, 'wss:').replace(/\/$/, '');

    logVerbose(verbose, `Upgrading to WebSocket: ${wsUrl}/ws/session`);

    const ws = new WebSocket(`${wsUrl}/ws/session`, {
      headers: {
        'x-session-token': session.sessionToken
      }
    });

    ws.on('open', () => {
      logVerbose(verbose, 'WebSocket connected');
      session.ws = ws;
      resolve();
    });

    ws.on('error', (err: Error) => {
      logVerbose(verbose, 'WebSocket error:', (err as Error).message);
      reject(err);
    });

    ws.on('close', () => {
      logVerbose(verbose, 'WebSocket closed');
      session.ws = undefined;
    });

    ws.on('message', async (data) => {
      // Handle incoming messages asynchronously
      await handleWebSocketMessage(data, session, verbose);
    });
  });
}

export async function handleWebSocketMessage(
  data: unknown,
  session: ControllerSession,
  verbose?: boolean
): Promise<void> {
  try {
    const envelope = JSON.parse(data instanceof Buffer ? data.toString('utf8') : String(data)) as WsEnvelope;

    if (envelope.type === 'heartbeat') {
      logVerbose(verbose, 'Received heartbeat');
      return;
    }

    if (envelope.type === 'encrypted') {
      await handleEncryptedResponse(envelope.payload as EncryptedMessage, session, verbose);
      return;
    }

    logVerbose(verbose, 'Received message type:', envelope.type);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Message handling error:', (err as Error).message);
  }
}

export async function handleEncryptedResponse(
  encrypted: EncryptedMessage,
  session: ControllerSession,
  verbose?: boolean
): Promise<void> {
  try {
    if (!session.sessionKey) {
      throw new Error('Session key not established');
    }

    const plaintext = await decryptAesGcm(encrypted, session.sessionKey);
    const response = JSON.parse(Buffer.from(plaintext).toString('utf8')) as ApduResponse;

    logVerbose(verbose, 'Decrypted response:', response);

    // Display response
    if (response.dataHex) {
      // eslint-disable-next-line no-console
      console.info(chalk.green(`Data: ${response.dataHex}`));
    }
    // eslint-disable-next-line no-console
    console.info(chalk.green(`SW: ${response.sw}`));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(chalk.red(`Response handling error: ${(err as Error).message}`));
  }
}

export async function prepareSessionKey(session: ControllerSession): Promise<void> {
  // Perform ECDH key exchange with Cardhost
  // For now, derive session key from ephemeral keypair
  // In a real system, this would involve a full ECDH handshake
  const salt = new Uint8Array(32);
  webcrypto.getRandomValues(salt);
  const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));

  // Stub: use ephemeral public key as shared secret for demo
  const sharedSecret = new Uint8Array(Buffer.from(session.ephemeralPublicKey.slice(0, 32), 'utf8'));
  session.sessionKey = await deriveSessionKey(sharedSecret, salt, info);
}

export async function sendApduWithEncryption(
  apduHex: string,
  session: ControllerSession,
  verbose?: boolean
): Promise<void> {
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }

  if (!session.sessionKey) {
    throw new Error('Session key not established');
  }

  // Create APDU command
  const command = { hex: apduHex };
  const plaintext = new Uint8Array(Buffer.from(JSON.stringify(command), 'utf8'));

  // Encrypt
  const encrypted = await encryptAesGcm(plaintext, session.sessionKey);

  const message: EncryptedMessage = {
    ...encrypted,
    senderPublicKey: session.ephemeralPublicKey
  };

  const envelope: WsEnvelope = {
    type: 'encrypted',
    payload: message,
    seq: ++session.seqNumber,
    ts: new Date().toISOString()
  };

  logVerbose(verbose, 'Sending encrypted APDU');
  session.ws.send(JSON.stringify(envelope));
}