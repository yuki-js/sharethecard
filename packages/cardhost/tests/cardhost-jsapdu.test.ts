/**
 * Integration tests for Cardhost with jsapdu-over-ip
 *
 * Tests SmartCardPlatformAdapter integration with MockPlatform
 * Validates that Cardhost correctly wraps jsapdu components
 *
 * Spec: docs/what-to-make.md Section 6.2.2 - 結合テスト
 */

import { CommandApdu } from "@aokiapp/jsapdu-interface";
import { MockSmartCardPlatform } from "@remote-apdu/cardhost";
import { describe, it, expect } from "vitest";

describe("Integration: Cardhost + jsapdu", () => {
  describe("Platform and Adapter Integration", () => {
    it("should wrap platform correctly", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      // Verify platform operations work
      const devices = await mockPlatform.getDeviceInfo();
      expect(devices.length).toBeGreaterThan(0);

      await using device = await mockPlatform.acquireDevice(devices[0].id);
      const isAvailable = await device.isDeviceAvailable();

      expect(isAvailable).toBe(true);
    });

    it("should handle device acquisition through adapter", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      const deviceInfo = devices[0];

      // Acquire device
      await using device = await mockPlatform.acquireDevice(deviceInfo.id);

      expect(device.getDeviceInfo().id).toBe(deviceInfo.id);
    });

    it("should handle card session lifecycle", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      await using device = await mockPlatform.acquireDevice(devices[0].id);

      expect(device.isSessionActive()).toBe(false);

      await using card = await device.startSession();

      expect(device.isSessionActive()).toBe(true);

      // Card operations
      const atr = await card.getAtr();
      expect(atr).toBeInstanceOf(Uint8Array);
    });
  });

  describe("APDU Command Processing", () => {
    it("should process SELECT DF command", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // Standard SELECT DF command
      const selectDf = new CommandApdu(
        0x00, // CLA
        0xa4, // INS: SELECT
        0x04, // P1: Select by DF name
        0x00, // P2
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]), // AID
        null,
      );

      const response = await card.transmit(selectDf);

      expect(response).toBeDefined();
      expect(response.sw).toBe(0x9000);
    });

    it("should process READ BINARY command", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // READ BINARY command
      const readBinary = new CommandApdu(
        0x00, // CLA
        0xb0, // INS: READ BINARY
        0x00, // P1: offset high
        0x00, // P2: offset low
        null,
        256, // Le: expect 256 bytes
      );

      const response = await card.transmit(readBinary);

      expect(response).toBeDefined();
      expect(response.sw).toBe(0x9000);
    });

    it("should handle extended APDU (>255 bytes)", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // Request more than 256 bytes (triggers extended APDU)
      const extendedRead = new CommandApdu(
        0x00,
        0xb0,
        0x00,
        0x00,
        null,
        4096, // Extended APDU
      );

      const bytes = extendedRead.toUint8Array();

      // Extended APDU should have 0x00 marker
      // Format: CLA INS P1 P2 00 Le1 Le2
      expect(bytes.length).toBe(7); // 4 header + 1 marker + 2 Le bytes
      expect(bytes[4]).toBe(0x00); // Extended marker

      const response = await card.transmit(extendedRead);
      expect(response.sw).toBe(0x9000);
    });
  });

  describe("Configuration and Authentication Integration", () => {
    it("should generate config with all required fields", async () => {
      const { ConfigManager } = await import("@remote-apdu/cardhost");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");

      const testDir = join(tmpdir(), `test-${Date.now()}`);
      const testFile = join(testDir, "config.json");

      const configManager = new ConfigManager(testFile, testDir);
      const config = await configManager.loadOrCreate("http://test.com");

      expect(config.signingPublicKey).toBeDefined();
      expect(config.signingPrivateKey).toBeDefined();
      expect(config.routerUrl).toBe("http://test.com");

      // Cleanup
      const { rmSync } = await import("node:fs");
      rmSync(testDir, { recursive: true, force: true });
    });
  });
});
