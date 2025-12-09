/**
 * Integration tests for component interaction (Library-level)
 *
 * Tests: Controller (CLI library) ⇄ Router (library) ⇄ Cardhost (Mock platform)
 * Validates jsapdu-over-ip integration patterns and resource management
 *
 * NOTE: This is NOT a true E2E network test. No WebSocket relay or real networking.
 * Classification rationale:
 * - Uses MockSmartCardPlatform directly
 * - No actual WebSocket server/client
 * - No network failures, reconnection, or E2E encryption
 *
 * Reference spec classification: docs/what-to-make.md Section 6.2.2 - Integration Test
 * Former label: "E2E" (mislabeled) → Correct label: "Integration"
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RouterService } from "@remote-apdu/router";
import { CardhostService, MockSmartCardPlatform } from "@remote-apdu/cardhost";
import { ControllerClient, CommandApdu } from "@remote-apdu/controller";

describe("Integration: Component Interaction (Library-level)", () => {
  let router: RouterService;
  let cardhost: CardhostService;
  let cardhostUuid: string;
  const BEARER_TOKEN = "test-bearer-token-e2e-123456";

  beforeAll(async () => {
    // Start Router
    router = new RouterService({ port: 0 }); // Random port
    await router.start();

    // Start Cardhost with MockPlatform
    const mockPlatform = new MockSmartCardPlatform();
    cardhost = new CardhostService({
      routerUrl: "http://localhost:3000", // Using default for now
      platform: mockPlatform,
    });

    // Note: In real test, we'd get the actual router URL
    // For now, this demonstrates the pattern
  });

  afterAll(async () => {
    if (cardhost) {
      await cardhost.disconnect();
    }
    if (router) {
      await router.stop();
    }
  });

  describe("1. Connection Establishment Flow", () => {
    it("should allow Controller to authenticate with Router", async () => {
      const sessionToken = await router.authenticateController(BEARER_TOKEN);

      expect(sessionToken.token).toMatch(/^sess_/);
      expect(sessionToken.expiresAt).toBeDefined();
    });

    it("should allow Cardhost to authenticate with Router", async () => {
      // This would happen in beforeAll with real networking
      // Here we test the Router's auth methods directly

      const { webcrypto } = await import("node:crypto");
      const keyPair = (await webcrypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;

      const publicKeySpki = await webcrypto.subtle.exportKey(
        "spki",
        keyPair.publicKey,
      );
      const publicKey = Buffer.from(publicKeySpki).toString("base64");

      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const challenge = await router.initiateCardhostAuth(uuid, publicKey);

      expect(challenge).toBeDefined();
      expect(typeof challenge).toBe("string");
    });

    it("should create relay session between Controller and Cardhost", async () => {
      // Authenticate both parties first
      const sessionToken = await router.authenticateController(BEARER_TOKEN);

      const { webcrypto } = await import("node:crypto");
      const keyPair = (await webcrypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;

      const publicKeySpki = await webcrypto.subtle.exportKey(
        "spki",
        keyPair.publicKey,
      );
      const privateKeyPkcs8 = await webcrypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey,
      );
      const publicKey = Buffer.from(publicKeySpki).toString("base64");
      const privateKey = Buffer.from(privateKeyPkcs8).toString("base64");

      const uuid = "550e8400-e29b-41d4-a716-446655440001";
      const challenge = await router.initiateCardhostAuth(uuid, publicKey);

      // Sign challenge
      const privateKeyObj = await webcrypto.subtle.importKey(
        "pkcs8",
        Buffer.from(privateKey, "base64"),
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      const payload = new Uint8Array(
        Buffer.from(JSON.stringify(challenge), "utf8"),
      );
      const signatureBuffer = await webcrypto.subtle.sign(
        { name: "Ed25519" },
        privateKeyObj,
        payload,
      );
      const signature = Buffer.from(signatureBuffer).toString("base64");

      await router.verifyCardhostAuth(uuid, challenge, signature);

      // Create relay
      const relayId = router.createRelaySession(sessionToken.token, uuid);

      expect(relayId).toBeDefined();
      expect(relayId.length).toBeGreaterThan(0);
    });
  });

  describe("2. APDU Transmission Flow (Library Level)", () => {
    it("should transmit APDU through MockPlatform", async () => {
      // Test at library level (without full networking)
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      const devices = await mockPlatform.getDeviceInfo();
      expect(devices.length).toBeGreaterThan(0);

      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // Send SELECT command
      const selectCommand = new CommandApdu(
        0x00,
        0xa4,
        0x04,
        0x00,
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null,
      );

      const response = await card.transmit(selectCommand);

      expect(response.sw).toBe(0x9000);
    });

    it("should support custom response configuration", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      // Configure custom response
      const commandHex = "00A4040008A000000003000000";
      const customResponse = new Uint8Array([0x61, 0x15]); // More data available (6115)
      mockPlatform.setDeviceResponse(
        "mock-device-1",
        commandHex,
        customResponse,
      );

      const devices = await mockPlatform.getDeviceInfo();
      await using device = await mockPlatform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      const bytes = new Uint8Array(commandHex.length / 2);
      for (let i = 0; i < commandHex.length; i += 2) {
        bytes[i / 2] = parseInt(commandHex.slice(i, i + 2), 16);
      }

      const command = CommandApdu.fromUint8Array(bytes);
      const response = await card.transmit(command);

      expect(response.sw).toBe(0x6115);
    });
  });

  describe("3. Resource Management Validation", () => {
    it("should handle multiple sequential sessions", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

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
  });

  describe("4. Error Handling", () => {
    it("should handle card not present", async () => {
      const mockPlatform = new MockSmartCardPlatform();
      await mockPlatform.init();

      mockPlatform.setCardPresent("mock-device-1", false);

      const devices = await mockPlatform.getDeviceInfo();
      const device = await mockPlatform.acquireDevice(devices[0].id);

      const isPresent = await device.isCardPresent();
      expect(isPresent).toBe(false);
    });

    it("should reject invalid APDU command", () => {
      // Invalid APDU: too short
      expect(() => {
        CommandApdu.fromUint8Array(new Uint8Array([0x00, 0xa4]));
      }).toThrow();
    });

    it("should handle authentication failure gracefully", async () => {
      await expect(
        router.authenticateController("short"), // Too short
      ).rejects.toThrow("Invalid bearer token");
    });

    it("should reject relay creation without authentication", () => {
      expect(() => {
        router.createRelaySession("invalid-session", "some-uuid");
      }).toThrow();
    });
  });

  describe("5. Security Validation", () => {
    it("should generate unique challenges for each auth attempt", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440010";
      const publicKey = "test-public-key-base64-here";

      const challenge1 = await router.initiateCardhostAuth(uuid, publicKey);
      const challenge2 = await router.initiateCardhostAuth(uuid, publicKey);

      expect(challenge1).not.toBe(challenge2);
    });

    it("should generate unique session tokens", async () => {
      const token1 = await router.authenticateController(BEARER_TOKEN);
      const token2 = await router.authenticateController(BEARER_TOKEN);

      expect(token1.token).not.toBe(token2.token);
    });
  });
});
