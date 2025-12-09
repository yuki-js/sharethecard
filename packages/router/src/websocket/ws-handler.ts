/**
 * WebSocket handler extracted from index.ts to reduce file size and improve modularity.
 * Provides heartbeat and basic relay logic per docs/what-to-make.md.
 */

import type { WsEnvelope } from '@remote-apdu/shared';
import crypto from 'node:crypto';

export interface SessionRelay {
  controllerId: string;
  cardhostId: string;
  createdAt: Date;
}

function cryptoRandomBase64(n: number): string {
  const buf = crypto.randomBytes(n);
  return Buffer.from(buf).toString('base64');
}

/**
 * Create WebSocket handler for upgradeWebSocket.
 * The returned callback matches the signature expected by Hono's upgradeWebSocket.
 */
export function makeWsHandler(
  sessionRelays: Map<string, SessionRelay>,
  activeControllerWs: Map<string, Record<string, unknown>>,
  activeCardhostWs: Map<string, Record<string, unknown>>
) {
  return (_c: unknown) => {
    return {
      onOpen(ws: unknown) {
        const clientId = cryptoRandomBase64(8);
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ws as any).send(JSON.stringify(envelope));
          } catch {
            // Connection might be closed
          }
        }, 30_000);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ws as any)._hbInterval = hbInterval;
        // eslint-disable-next-line no-console
        console.info(`WebSocket client connected: ${clientId}`);
      },

      onMessage(ws: unknown, message: unknown) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wsData = (ws as any)._data;
          const envelope = JSON.parse(
            message instanceof Buffer ? message.toString('utf8') : String(message)
          ) as WsEnvelope;

          // Heartbeat pong handling
          if (envelope.type === 'heartbeat') {
            return;
          }

          // Encrypted relay handling
          if (envelope.type === 'encrypted') {
            for (const [_relayId, relay] of sessionRelays.entries()) {
              const isController = activeControllerWs.has(relay.controllerId);
              const isCardhost = activeCardhostWs.has(relay.cardhostId);

              if (isController && wsData.clientId === relay.controllerId) {
                const cardhostWsData = activeCardhostWs.get(relay.cardhostId);
                if (cardhostWsData) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (ws as any).send(JSON.stringify(envelope));
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to forward to cardhost:', (err as Error).message);
                  }
                }
              } else if (isCardhost && wsData.clientId === relay.cardhostId) {
                const controllerWsData = activeControllerWs.get(relay.controllerId);
                if (controllerWsData) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (ws as any).send(JSON.stringify(envelope));
                  } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to forward to controller:', (err as Error).message);
                  }
                }
              }
            }
            return;
          }

          // Echo fallback for other message types
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ws as any).send(JSON.stringify(envelope));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('WebSocket message handling error:', (err as Error).message);
        }
      },

      onClose(ws: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wsData = (ws as any)._data;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hbInterval = (ws as any)._hbInterval;

        if (hbInterval) {
          clearInterval(hbInterval);
        }

        // Remove from registries (note: upstream code should populate these maps)
        activeControllerWs.delete(wsData.clientId);
        activeCardhostWs.delete(wsData.clientId);

        // eslint-disable-next-line no-console
        console.info(`WebSocket client disconnected: ${wsData.clientId}`);
      }
    };
  };
}