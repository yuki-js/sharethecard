#!/usr/bin/env node
/**
 * Router Runtime - Standalone Server
 * Thin wrapper around RouterService library with Hono HTTP server
 * 
 * This is the "下駄" (runtime wrapper) that makes the library work as standalone service
 * Spec: docs/what-to-make.md Section 3.5 - 共通項
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { RouterService } from '../lib/index.js';
import type { SessionToken } from '@remote-apdu/shared';

const app = new Hono();
const router = new RouterService();

/**
 * GET /cardhosts - List connected Cardhosts
 */
app.get('/cardhosts', (c) => {
  const list = router.listCardhosts();
  return c.json(list);
});

/**
 * POST /controller/connect - Controller bearer token authentication
 * Spec: docs/what-to-make.md Section 4.2.1
 */
app.post('/controller/connect', async (c) => {
  const auth = c.req.header('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  
  if (!match) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const bearerToken = match[1];

  try {
    const sessionToken: SessionToken = await router.authenticateController(bearerToken);
    return c.json(sessionToken, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 401);
  }
});

/**
 * POST /cardhost/connect - Cardhost authentication step 1 (issue challenge)
 * Spec: docs/what-to-make.md Section 4.1.1
 */
app.post('/cardhost/connect', async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { uuid, publicKey } = body as { uuid?: string; publicKey?: string };

  if (!uuid || !publicKey) {
    return c.json({ error: 'uuid and publicKey required' }, 400);
  }

  try {
    const challenge = await router.initiateCardhostAuth(uuid, publicKey);
    return c.json({ challenge }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /cardhost/verify - Cardhost authentication step 2 (verify signature)
 * Spec: docs/what-to-make.md Section 4.1.1
 */
app.post('/cardhost/verify', async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { uuid, challenge, signature } = body as {
    uuid?: string;
    challenge?: string;
    signature?: string;
  };

  if (!uuid || !challenge || !signature) {
    return c.json({ error: 'uuid, challenge, and signature required' }, 400);
  }

  try {
    const isValid = await router.verifyCardhostAuth(uuid, challenge, signature);
    
    if (!isValid) {
      return c.json({ error: 'Signature verification failed' }, 401);
    }

    return c.json({ ok: true }, 200);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * POST /sessions - Create relay session between Controller and Cardhost
 * Spec: docs/what-to-make.md Section 4.2.2
 */
app.post('/sessions', async (c) => {
  const sessionToken = c.req.header('x-session-token') ?? '';

  if (!router.validateControllerSession(sessionToken)) {
    return c.json({ error: 'Invalid or expired session token' }, 401);
  }

  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const { cardhostUuid } = body as { cardhostUuid?: string };

  if (!cardhostUuid) {
    return c.json({ error: 'cardhostUuid required' }, 400);
  }

  try {
    const relayId = router.createRelaySession(sessionToken, cardhostUuid);
    return c.json({ relayId }, 201);
  } catch (error) {
    const message = (error as Error).message;
    
    if (message.includes('not connected')) {
      return c.json({ error: message }, 404);
    }
    
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/jsapdu/rpc - RPC endpoint for jsapdu-over-ip
 * This is where Controller sends jsapdu-interface calls
 * Router relays to Cardhost
 */
app.post('/api/jsapdu/rpc', async (c) => {
  const sessionToken = c.req.header('x-session-token') ?? '';
  const cardhostUuid = c.req.header('x-cardhost-uuid') ?? '';

  if (!router.validateControllerSession(sessionToken)) {
    return c.json({ 
      error: { 
        code: 'UNAUTHORIZED', 
        message: 'Invalid or expired session token' 
      } 
    }, 401);
  }

  if (!cardhostUuid) {
    return c.json({ 
      error: { 
        code: 'BAD_REQUEST', 
        message: 'x-cardhost-uuid header required' 
      } 
    }, 400);
  }

  const request = await c.req.json();

  // Relay RPC request to Cardhost via session relay
  const relay = router.getSessionRelay();
  const response = await relay.relayToCardhost(sessionToken, request);

  return c.json(response);
});

/**
 * GET /stats - Router statistics
 */
app.get('/stats', (c) => {
  const stats = router.getStats();
  return c.json(stats);
});

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';

  // Start Router service
  await router.start();

  console.log('Starting Router Server...');
  console.log(`Listening on http://${host}:${port}`);

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down Router...');
    await router.stop();
    server.close();
    console.log('✓ Stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export default app;