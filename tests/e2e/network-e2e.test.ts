/**
 * Real network E2E (single process): start the real Router runtime (HTTP + WS),
 * open an actual TCP port, and verify Controller ⇄ Router ⇄ Cardhost APDU flow.
 *
 * Router is a real server, but cohabits this test process. Mocks/spies remain possible.
 *
 * Flows covered:
 * - Cardhost authenticates via HTTP (/cardhost/connect → /cardhost/verify)
 * - Cardhost establishes WS relay to /api/jsapdu/ws with headers (x-role, x-cardhost-uuid)
 * - Controller authenticates via HTTP (/controller/connect)
 * - Controller creates relay (/sessions) and transmits APDU via HTTP /api/jsapdu/rpc
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Start the real runtime server inside this process on a dedicated port
import { startRuntimeServer } from '../../packages/router/src/runtime/server.ts';

// Cardhost (server-side) and Controller (client-side) libraries
import { CardhostService, MockSmartCardPlatform, ConfigManager } from '@remote-apdu/cardhost';
import { ControllerClient, CommandApdu } from '@remote-apdu/controller';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

describe('E2E: Real network end-to-end (HTTP+WS, single process)', () => {
  const HOST = '127.0.0.1';
  const PORT = 31101; // dedicated test port
  const BASE_URL = `http://${HOST}:${PORT}`;
  const BEARER_TOKEN = 'test-bearer-token-e2e-123456';

  let runtime: Awaited<ReturnType<typeof startRuntimeServer>> | null = null;
  let cardhost: CardhostService | null = null;
  let mockPlatform: MockSmartCardPlatform | null = null;
  let testDir: string | null = null;

  beforeAll(async () => {
    // Start the real Router runtime (HTTP + WebSocket) on a real port
    runtime = await startRuntimeServer(PORT, HOST);

    // Start Cardhost with Mock platform (connects over WS to the Router runtime)
    mockPlatform = new MockSmartCardPlatform();

    // Ensure defaults and persisted config point to the active test runtime port
    process.env.ROUTER_URL = BASE_URL;
    testDir = join(tmpdir(), `network-e2e-${Date.now()}`);
    const testFile = join(testDir, 'config.json');
    const configManager = new ConfigManager(testFile, testDir);

    cardhost = new CardhostService({
      routerUrl: BASE_URL,
      platform: mockPlatform,
      configManager
    });
    await cardhost.connect();
    // Allow WS registration to settle (SessionRelay.registerCardhostConnection)
    await new Promise((r) => setTimeout(r, 50));
  });

  afterAll(async () => {
    // Disconnect Cardhost
    if (cardhost) {
      await cardhost.disconnect();
      cardhost = null;
    }
    mockPlatform = null;

    // Stop Router runtime
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }

    // Cleanup temp config dir
    if (testDir) {
      try { rmSync(testDir, { recursive: true, force: true }); } catch {}
      testDir = null;
    }
  });

  it('should transmit APDU end-to-end (Controller → HTTP RPC → WS Relay → Cardhost)', async () => {
    if (!cardhost) throw new Error('Cardhost not started');
    const cardhostUuid = cardhost.getUuid();

    // Controller uses HTTP (/controller/connect, /sessions, /api/jsapdu/rpc)
    const client = new ControllerClient({
      routerUrl: BASE_URL,
      token: BEARER_TOKEN,
      cardhostUuid
    });

    await client.connect();
    // Allow settle before issuing first RPC
    await new Promise((r) => setTimeout(r, 50));
    // Allow session relay/controller registration to settle before first RPC
    await new Promise((r) => setTimeout(r, 50));

    try {
      // SELECT command over the full network stack
      const select = new CommandApdu(
        0x00, 0xA4, 0x04, 0x00,
        new Uint8Array([0xA0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null
      );

      const response = await client.transmit(select);
      expect(response.sw).toBe(0x9000);
    } finally {
      await client.disconnect();
    }
  });

  it('should allow custom APDU responses from Cardhost mock over the network', async () => {
    if (!cardhost || !mockPlatform) throw new Error('Cardhost not started');

    // Configure mock response (held on the Cardhost side)
    const commandHex = '00A4040008A000000003000000';
    const customResponse = new Uint8Array([0x61, 0x15]); // SW=0x6115
    mockPlatform.setDeviceResponse('mock-device-1', commandHex, customResponse);

    const cardhostUuid = cardhost.getUuid();

    const client = new ControllerClient({
      routerUrl: BASE_URL,
      token: BEARER_TOKEN,
      cardhostUuid
    });

    await client.connect();

    try {
      // Build command from hex
      const bytes = new Uint8Array(commandHex.length / 2);
      for (let i = 0; i < commandHex.length; i += 2) {
        bytes[i / 2] = parseInt(commandHex.slice(i, i + 2), 16);
      }
      const command = CommandApdu.fromUint8Array(bytes);

      const response = await client.transmit(command);
      expect(response.sw).toBe(0x6115);
    } finally {
      await client.disconnect();
    }
  });
});