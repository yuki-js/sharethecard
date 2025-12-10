/**
 * Real network E2E (single process): start the real Router runtime (HTTP + WS),
 * open an actual TCP port, and verify Controller ⇄ Router ⇄ Cardhost APDU flow.
 *
 * Router is a real server, but cohabits this test process. Mocks/spies remain possible.
 *
 * Flows covered:
 * - Cardhost authenticates via WebSocket message-based auth (v3.0)
 * - Cardhost establishes persistent WS connection
 * - Controller authenticates via WebSocket message-based auth (v3.0)
 * - Controller transmits APDU via WebSocket RPC
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Start the real runtime server inside this process on a dedicated port
import { startServer } from "@remote-apdu/router";

// Cardhost (server-side) and Controller (client-side) libraries
import {
  CardhostService,
  MockSmartCardPlatform,
  ConfigManager,
} from "@remote-apdu/cardhost";
import { ControllerClient, CommandApdu } from "@remote-apdu/controller";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

describe.sequential("E2E: Real network end-to-end", () => {
  const HOST = "127.0.0.1";
  const PORT = 31101; // dedicated test port
  const BASE_URL = `http://${HOST}:${PORT}`;

  let runtime: Awaited<ReturnType<typeof startServer>> | null = null;
  let cardhost: CardhostService | null = null;
  let mockPlatform: MockSmartCardPlatform | null = null;
  let testDir: string | null = null;

  beforeAll(async () => {
    // Start the real Router runtime (HTTP + WebSocket) on a real port
    runtime = await startServer({
      port: PORT,
      host: HOST,
    });

    // Start Cardhost with Mock platform (connects over WS to the Router runtime)
    mockPlatform = new MockSmartCardPlatform();
    await mockPlatform.init(); // Initialize platform before connecting

    // Ensure defaults and persisted config point to the active test runtime port
    process.env.ROUTER_URL = BASE_URL;
    testDir = join(tmpdir(), `network-e2e-${Date.now()}`);
    const testFile = join(testDir, "config.json");
    const configManager = new ConfigManager(testFile, testDir);

    cardhost = new CardhostService({
      routerUrl: BASE_URL,
      platform: mockPlatform,
      configManager,
    });
    await cardhost.connect(BASE_URL);
    // Allow WS registration to settle
    await new Promise((r) => setTimeout(r, 100));
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
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
      testDir = null;
    }
  });

  it("should transmit APDU end-to-end (Controller → WS RPC → Router → Cardhost)", async () => {
    if (!cardhost) throw new Error("Cardhost not started");
    const cardhostUuid = cardhost.getUuid();

    // Controller uses WebSocket-only (v3.0 spec)
    const client = new ControllerClient({
      routerUrl: BASE_URL,
      cardhostUuid,
    });

    await client.connect();
    // Allow settle before issuing first RPC
    await new Promise((r) => setTimeout(r, 100));

    try {
      // SELECT command over the full network stack
      const select = new CommandApdu(
        0x00,
        0xa4,
        0x04,
        0x00,
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null,
      );

      const response = await client.transmit(select);
      expect(response.sw).toBe(0x9000);
    } finally {
      await client.disconnect();
    }
  });

  it("should perform a realistic stateful APDU sequence over a single persistent WS session", async () => {
    if (!cardhost) throw new Error("Cardhost not started");
    const cardhostUuid = cardhost.getUuid();

    const client = new ControllerClient({
      routerUrl: BASE_URL,
      cardhostUuid,
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 100));

    try {
      // Step 1: SELECT AID -> 9000
      const selectAid = new CommandApdu(
        0x00,
        0xa4,
        0x04,
        0x00,
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null,
      );
      let rsp = await client.transmit(selectAid);
      expect(rsp.sw).toBe(0x9000);

      // Step 2: GET DATA -> payload "MOCK" + 9000
      const getData = new CommandApdu(0x00, 0xca, 0x00, 0x00, null, 0);
      rsp = await client.transmit(getData);
      expect(rsp.sw).toBe(0x9000);
      if (rsp.data) {
        expect([...rsp.data]).toEqual([0x4d, 0x4f, 0x43, 0x4b]);
      } else {
        throw new Error("GET DATA returned no payload");
      }

      // Step 3: VERIFY wrong PIN "1234" -> 63C2 (2 retries left)
      const verifyWrong = new CommandApdu(
        0x00,
        0x20,
        0x00,
        0x00,
        new Uint8Array([0x31, 0x32, 0x33, 0x34]),
        null,
      );
      rsp = await client.transmit(verifyWrong);
      expect(rsp.sw).toBe(0x63c2);

      // Step 4: GET CHALLENGE -> 8 bytes + 9000
      const getChallenge = new CommandApdu(0x00, 0x84, 0x00, 0x00, null, 8);
      rsp = await client.transmit(getChallenge);
      expect(rsp.sw).toBe(0x9000);
      expect(rsp.data?.length ?? 0).toBe(8);

      // Step 5: READ BINARY Le=16 -> 16 bytes + 9000
      const read16 = new CommandApdu(0x00, 0xb0, 0x00, 0x00, null, 0x10);
      rsp = await client.transmit(read16);
      expect(rsp.sw).toBe(0x9000);
      expect(rsp.data?.length ?? 0).toBe(16);

      // Step 6: READ BINARY (short APDU) Le=256 encoded as Le=0 -> 9000, no payload
      const readShort256 = new CommandApdu(0x00, 0xb0, 0x00, 0x00, null, 0);
      rsp = await client.transmit(readShort256);
      expect(rsp.sw).toBe(0x9000);
      expect(rsp.data?.length ?? 0).toBe(0);

      // Step 7: READ BINARY (extended APDU) Le=256 -> 9000, no payload
      const readExt256 = new CommandApdu(0x00, 0xb0, 0x00, 0x00, null, 256);
      rsp = await client.transmit(readExt256);
      expect(rsp.sw).toBe(0x9000);
      expect(rsp.data?.length ?? 0).toBe(0);

      // Step 8: READ BINARY (extended APDU) Le=4096 -> 9000, no payload
      const readExt4096 = new CommandApdu(0x00, 0xb0, 0x00, 0x00, null, 4096);
      rsp = await client.transmit(readExt4096);
      expect(rsp.sw).toBe(0x9000);
      expect(rsp.data?.length ?? 0).toBe(0);

      // Step 9: SELECT non-existent file -> 6A82
      const selectInvalid = new CommandApdu(
        0x00,
        0xa4,
        0x00,
        0x00,
        new Uint8Array([0xff, 0xff]),
        null,
      );
      rsp = await client.transmit(selectInvalid);
      expect(rsp.sw).toBe(0x6a82);

      // Step 10: GET RESPONSE wrong Le -> 6C10
      const getRespWrongLen = new CommandApdu(0x00, 0xc0, 0x00, 0x00, null, 0);
      rsp = await client.transmit(getRespWrongLen);
      expect(rsp.sw).toBe(0x6c10);

      // Step 11: Security status not satisfied -> 6982
      const secNotSatisfied = new CommandApdu(
        0x00,
        0xd0,
        0x00,
        0x00,
        new Uint8Array([0x01, 0x02, 0x03, 0x04]),
        null,
      );
      rsp = await client.transmit(secNotSatisfied);
      expect(rsp.sw).toBe(0x6982);

      // Step 12: SELECT AID again to ensure session continuity -> 9000
      const selectAgain = new CommandApdu(
        0x00,
        0xa4,
        0x04,
        0x00,
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null,
      );
      rsp = await client.transmit(selectAgain);
      expect(rsp.sw).toBe(0x9000);
    } finally {
      await client.disconnect();
    }
  });
});
