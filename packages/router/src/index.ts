/**
 * Router Server
 * Bridges Controller and Cardhost with REST/WebSocket, authentication, and session relay.
 * Spec: docs/what-to-make.md (Section 3.3)
 */

import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/ws';
import type { SessionToken, WsEnvelope, EncryptedMessage } from '@remote-apdu/shared';
import { verifyJsonEd25519 } from '@remote-apdu/shared';
import { webcrypto } from 'node:crypto';
import { serve } from '@hono/node-server';

interface CardhostRegistry {
  uuid: string;
  publicKey: string;
  connected: boolean;
  ws?: Record<string, unknown>;
}

interface ControllerSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
  cardhostUuid?: string;
}

interface CardhostChallenge {
  challenge: string;
  timestamp: number;
}

// In-memory registries (replace with DB in production)
const cardhostRegistry = new Map<string, CardhostRegistry>();
const cardhostChallenges = new Map<string, CardhostChallenge>();
const controllerSessions = new Map<string, ControllerSession>();
const activeCardhostWs = new Map<string, Record<string, unknown>>();
const activeControllerWs = new Map<string, Record<string, unknown>>();

// Session relay: maps controller sessionId to { controllerWs, cardhostWs }
interface SessionRelay {
  controllerId: string;
  cardhostId: string;
  createdAt: Date;
}
const sessionRelays = new Map<string, SessionRelay>();

const app = new Hono();

function cryptoRandomBase64(n: number): string {
  const buf = new Uint8Array(n);
  webcrypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64');
}

function generateSessionToken(): string {
  return `sess_${cryptoRandomBase64(32)}`;
}

function verifyBearerToken(token: string): boolean {
  // TODO: Implement proper JWT or token verification
  // For now, accept any non-empty token of sufficient length
  return token.length >= 10;
}

/**
 * List Cardhosts
 */
app.get('/cardhosts', (c) => {
  const list = Array.from(cardhostRegistry.values()).map((ch) => ({
    uuid: ch.uuid,
    connected: ch.connected
  }));
  return c.json(list);
});

/**
 * Controller: POST /controller/connect
 * Bearer token authentication → issue session token
 * Spec: 4.2.1
 */
app.post('/controller/connect', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return c.json({ error: 'missing bearer token' }, 401);
  }

  const bearer = m[1];
  if (!verifyBearerToken(bearer)) {
    return c.json({ error: 'invalid bearer token' }, 401);
  }

  const sessionId = generateSessionToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  const session: ControllerSession = {
    sessionId,
    token: bearer,
    expiresAt
  };

  controllerSessions.set(sessionId, session);

  const response: SessionToken = {
    token: sessionId,
    expiresAt: expiresAt.toISOString()
  };

  return c.json(response, 201);
});

/**
 * Cardhost: POST /cardhost/connect
 * Public key + UUID → issue challenge
 * Spec: 4.1.1
 */
app.post('/cardhost/connect', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    uuid?: string;
    publicKey?: string;
  } | null;

  if (!body || !body.uuid || !body.publicKey) {
    return c.json({ error: 'uuid and publicKey required' }, 400);
  }

  const { uuid, publicKey } = body;

  // Register or update cardhost
  cardhostRegistry.set(uuid, {
    uuid,
    publicKey,
    connected: false
  });

  // Generate challenge
  const challenge = cryptoRandomBase64(32);
  cardhostChallenges.set(uuid, {
    challenge,
    timestamp: Date.now()
  });

  return c.json({ challenge }, 201);
});

/**
 * Cardhost: POST /cardhost/verify
 * Signature verification → authentication success
 * Spec: 4.1.1
 */
app.post('/cardhost/verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    uuid?: string;
    publicKey?: string;
    signature?: string;
    challenge?: string;
  } | null;

  if (!body || !body.uuid || !body.publicKey || !body.signature || !body.challenge) {
    return c.json({ error: 'uuid, publicKey, signature, challenge required' }, 400);
  }

  const { uuid, publicKey, signature, challenge } = body;

  // Verify challenge is recent (within 5 minutes)
  const stored = cardhostChallenges.get(uuid);
  if (!stored || Date.now() - stored.timestamp > 5 * 60 * 1000) {
    return c.json({ error: 'challenge expired' }, 400);
  }

  // Verify signature
  try {
    const isValid = await verifyJsonEd25519(challenge, publicKey, signature);
    if (!isValid) {
      return c.json({ error: 'signature verification failed' }, 401);
    }
  } catch (err) {
    return c.json({ error: 'verification error' }, 400);
  }

  // Update registry
  const ch = cardhostRegistry.get(uuid);
  if (ch) {
    ch.connected = true;
  }

  cardhostChallenges.delete(uuid);

  return c.json({ ok: true }, 200);
});

/**
 * Controller: POST /sessions
 * Establish session between Controller and Cardhost
 * Request body: { cardhostUuid: string }
 */
app.post('/sessions', async (c) => {
  const sessionToken = c.req.header('x-session-token') ?? '';
  const session = controllerSessions.get(sessionToken);

  if (!session || session.expiresAt < new Date()) {
    return c.json({ error: 'invalid or expired session' }, 401);
  }

  const body = (await c.req.json().catch(() => null)) as {
    cardhostUuid?: string;
  } | null;

  if (!body || !body.cardhostUuid) {
    return c.json({ error: 'cardhostUuid required' }, 400);
  }

  const { cardhostUuid } = body;
  const cardhost = cardhostRegistry.get(cardhostUuid);

  if (!cardhost || !cardhost.connected) {
    return c.json({ error: 'cardhost not found or offline' }, 404);
  }

  // Create session relay (websocket upgrade will use this)
  const relayId = cryptoRandomBase64(16);
  session.cardhostUuid = cardhostUuid;

  sessionRelays.set(relayId, {
    controllerId: sessionToken,
    cardhostId: cardhostUuid,
    createdAt: new Date()
  });

  return c.json({ relayId }, 201);
});

/**
 * WebSocket: /ws/session
 * Relay encrypted APDU messages between Controller and Cardhost
 * Spec: 4.1.2, 4.2.2, 4.3
 */
app.get(
  '/ws/session',
  upgradeWebSocket((c: any) => {
    return {
      onOpen(ws: any) {
        const clientId = cryptoRandomBase64(8);
        // Store websocket reference
        const wsData = { clientId, connected: true };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ws as any)._data = wsData;

        // Heartbeat
        const hbInterval = setInterval(() => {
          const envelope: WsEnvelope = {
            type: 'heartbeat',
            payload: { ping: Date.now() },
            ts: new Date().toISOString()
          };
          try {
            ws.send(JSON.stringify(envelope));
          } catch (err) {
            // Connection might be closed
          }
        }, 30_000);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ws as any)._hbInterval = hbInterval;
        // eslint-disable-next-line no-console
        console.info(`WebSocket client connected: ${clientId}`);
      },

      onMessage(ws: any, message: any) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wsData = (ws as any)._data;
          const envelope = JSON.parse(message instanceof Buffer ? message.toString('utf8') : String(message)) as WsEnvelope;

          // Handle heartbeat pong
          if (envelope.type === 'heartbeat') {
            // Just acknowledge, no response needed
            return;
          }

          // Handle encrypted messages (relay)
          if (envelope.type === 'encrypted') {
            // Find relay and forward to other peer
            for (const [relayId, relay] of sessionRelays.entries()) {
              // Check if sender is controller or cardhost
              const isController = activeControllerWs.has(relay.controllerId);
              const isCardhost = activeCardhostWs.has(relay.cardhostId);

              if (isController && wsData.clientId === relay.controllerId) {
                // Forward to cardhost
                const cardhostWsData = activeCardhostWs.get(relay.cardhostId);
                if (cardhostWsData) {
                  // Send to cardhost
                  try {
                    ws.send(JSON.stringify(envelope));
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to forward to cardhost:', (err as Error).message);
                  }
                }
              } else if (isCardhost && wsData.clientId === relay.cardhostId) {
                // Forward to controller
                const controllerWsData = activeControllerWs.get(relay.controllerId);
                if (controllerWsData) {
                  try {
                    ws.send(JSON.stringify(envelope));
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to forward to controller:', (err as Error).message);
                  }
                }
              }
            }
            return;
          }

          // Echo for other message types (fallback)
          ws.send(JSON.stringify(envelope));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('WebSocket message handling error:', (err as Error).message);
        }
      },

      onClose(ws: any) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wsData = (ws as any)._data;
        const hbInterval = (ws as any)._hbInterval;

        if (hbInterval) {
          clearInterval(hbInterval);
        }

        // Remove from registries
        activeControllerWs.delete(wsData.clientId);
        activeCardhostWs.delete(wsData.clientId);

        // eslint-disable-next-line no-console
        console.info(`WebSocket client disconnected: ${wsData.clientId}`);
      }
    };
  })
);

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
// eslint-disable-next-line no-console
console.info(`Router listening on http://localhost:${port}`);

export default app;
