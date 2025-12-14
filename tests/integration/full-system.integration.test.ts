/**
 * Integration tests for component interaction (Library-level)
 *
 * Tests: Router (library) ⇄ Cardhost (Mock platform) ⇄ Controller (CLI library)
 * Validates jsapdu-over-ip integration patterns and resource management
 *
 * Classification: Integration Test (Library Level)
 * - No network communication (no real WebSocket server)
 * - Tests business logic and jsapdu interface compliance
 * - Validates component interfaces and message handling
 *
 * Spec: docs/what-to-make.md Section 6.2.2 - 結合テスト
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Router } from "@remote-apdu/router";
import { MockSmartCardPlatform } from "@remote-apdu/cardhost";
import { CommandApdu } from "@aokiapp/jsapdu-interface";

describe("Integration: Component Interaction (Library-level)", () => {
  let router: Router;
  const mockPlatform = new MockSmartCardPlatform();

  beforeAll(async () => {
    // Initialize Router
    router = new Router();
    await router.start();

    // Initialize MockPlatform
    await mockPlatform.init();
  });

  afterAll(async () => {
    if (router) {
      await router.stop();
    }
  });

  describe("1. APDU Transmission via jsapdu Interface", () => {
    it("should transmit SELECT command through mock platform", async () => {
      const devices = await mockPlatform.getDeviceInfo();
      expect(devices.length).toBeGreaterThan(0);

      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      const selectCommand = new CommandApdu(
        0x00, // CLA
        0xa4, // INS: SELECT
        0x04, // P1: Select by DF name
        0x00, // P2
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null,
      );

      const response = await card.transmit(selectCommand);

      expect(response).toBeDefined();
      expect(response.sw).toBe(0x9000);
    });

    it("should transmit READ BINARY command", async () => {
      const devices = await mockPlatform.getDeviceInfo();
      
      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

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

      // Extended APDU should have proper encoding
      // Format: CLA INS P1 P2 00 Le1 Le2
      expect(bytes.length).toBe(7);
      expect(bytes[4]).toBe(0x00); // Extended marker

      const response = await card.transmit(extendedRead);
      expect(response.sw).toBe(0x9000);
    });
  });

  describe("2. Resource Management Validation", () => {
    it("should handle multiple sequential sessions", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      // Session 1
      {
        await using device = await mockPlatform.acquireDevice(devices[0].id);
        await using card = await device.startSession();
        await card.transmit(
          new CommandApdu(0x00, 0xa4, 0x04, 0x00, null, null),
        );
      }

      // Session 2 (should work after cleanup)
      {
        await using device = await mockPlatform.acquireDevice(devices[0].id);
        await using card = await device.startSession();
        await card.transmit(new CommandApdu(0x00, 0xb0, 0x00, 0x00, null, 256));
      }

      // Both sessions should succeed
      expect(true).toBe(true);
    });

    it("should properly release device resources", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      const device1 = await mockPlatform.acquireDevice(devices[0].id);
      expect(device1).toBeDefined();
      await device1[Symbol.asyncDispose]?.();

      // Should be able to acquire again
      const device2 = await mockPlatform.acquireDevice(devices[0].id);
      expect(device2).toBeDefined();
      await device2[Symbol.asyncDispose]?.();
    });
  });

  describe("3. Router Authentication Flow (UseCase Layer)", () => {
    it("should generate controller auth challenge", async () => {
      const publicKey = Buffer.from("test-key").toString("base64");
      
      const { controllerId, challenge } =
        await router.controllerUseCase.initiateAuth(publicKey);

      expect(controllerId).toBeDefined();
      expect(controllerId).toMatch(/^peer_/);
      expect(challenge).toBeDefined();
    });

    it("should create deterministic controller IDs", async () => {
      const publicKey = Buffer.from("deterministic-controller").toString("base64");

      const result1 = await router.controllerUseCase.initiateAuth(publicKey);
      const result2 = await router.controllerUseCase.initiateAuth(publicKey);

      // Same public key should produce same controller ID
      expect(result1.controllerId).toBe(result2.controllerId);
    });

    it("should generate unique challenges on each attempt", async () => {
      const publicKey = Buffer.from("challenge-test").toString("base64");

      const result1 = await router.controllerUseCase.initiateAuth(publicKey);
      const result2 = await router.controllerUseCase.initiateAuth(publicKey);

      // Even though ID is same, challenges should differ
      expect(result1.challenge).not.toBe(result2.challenge);
    });

    it("should generate cardhost auth challenge", async () => {
      const publicKey = Buffer.from("cardhost-key").toString("base64");

      const { uuid, challenge } =
        await router.cardhostUseCase.initiateAuth(publicKey);

      expect(uuid).toBeDefined();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(challenge).toBeDefined();
    });

    it("should require authentication before session creation", async () => {
      const controllerId = "peer_not_authenticated";
      const cardhostUuid = "peer_test-uuid";

      // Should throw because controller not authenticated
      expect(() => {
        router.controllerUseCase.createSession(controllerId, cardhostUuid);
      }).toThrow("Controller not authenticated");
    });
  });

  describe("4. Error Handling", () => {
    it("should reject invalid APDU command", () => {
      // Invalid APDU: too short
      expect(() => {
        CommandApdu.fromUint8Array(new Uint8Array([0x00, 0xa4]));
      }).toThrow();
    });

    it("should handle malformed command data", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // Try with minimal valid APDU
      const minimalCmd = new CommandApdu(0x00, 0x00, 0x00, 0x00, null, null);
      const response = await card.transmit(minimalCmd);

      expect(response).toBeDefined();
      // Should return some response, even if error status
      expect(typeof response.sw).toBe("number");
    });

    it("should handle card device status", async () => {
      const devices = await mockPlatform.getDeviceInfo();
      const device = await mockPlatform.acquireDevice(devices[0].id);

      // Check if device is available (may be true even if card not present)
      const isAvailable = await device.isDeviceAvailable();
      expect(typeof isAvailable).toBe("boolean");

      await device[Symbol.asyncDispose]?.();
    });
  });

  describe("5. Stats and Monitoring", () => {
    it("should report router statistics", () => {
      const stats = router.getStats();

      expect(stats).toBeDefined();
      expect(stats.running).toBe(true);
      expect(stats.activeControllers).toBeGreaterThanOrEqual(0);
      expect(stats.activeCardhosts).toBeGreaterThanOrEqual(0);
      expect(stats.activeSessions).toBeGreaterThanOrEqual(0);
    });

    it("should track device information", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      expect(Array.isArray(devices)).toBe(true);
      expect(devices.length).toBeGreaterThan(0);
      expect(devices[0]).toHaveProperty("id");
    });
  });

  describe("6. jsapdu Interface Compliance", () => {
    it("should support CardSession async disposal", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      const device = await mockPlatform.acquireDevice(devices[0].id);
      const card = await device.startSession();

      // Should support Symbol.asyncDispose
      expect(card[Symbol.asyncDispose]).toBeDefined();

      await card[Symbol.asyncDispose]?.();
      await device[Symbol.asyncDispose]?.();
    });

    it("should return proper Response APDU format", async () => {
      const devices = await mockPlatform.getDeviceInfo();

      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      const response = await card.transmit(
        new CommandApdu(0x00, 0xa4, 0x04, 0x00, null, null),
      );

      // ResponseApdu should have sw property
      expect(response).toHaveProperty("sw");
      expect(typeof response.sw).toBe("number");
      // SW ranges from 0x6000-0x9000
      expect(response.sw).toBeGreaterThanOrEqual(0x6000);
      expect(response.sw).toBeLessThanOrEqual(0x9fff);
    });
  });
});
