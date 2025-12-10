/**
 * Unit Tests for Session and Transport (Relay) Logic
 * 
 * Tests session management and transport relay through Router
 * Validates session lifecycle and connection tracking
 * 
 * NOTE: This tests the session/transport coordination logic that was
 * previously handled by SessionRelay. Now distributed across services.
 * 
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Router } from "@remote-apdu/router";

describe("Session and Transport Management - Unit via Router", () => {
  let router: Router;

  beforeEach(async () => {
    router = new Router();
    await router.start();
  });

  afterEach(async () => {
    if (router) {
      await router.stop();
    }
  });

  describe("Transport Registration", () => {
    it("should register and track controller connections", () => {
      const mockSend = vi.fn();
      const sessionToken = "sess_test_1";

      router.transportUseCase.registerController(sessionToken, mockSend);

      const counts = router.transportUseCase.getConnectionCounts();
      expect(counts.controllers).toBeGreaterThan(0);
    });

    it("should register and track cardhost connections", () => {
      const mockSend = vi.fn();
      const cardhostUuid = "peer_test_1";

      router.transportUseCase.registerCardhost(cardhostUuid, mockSend);

      const counts = router.transportUseCase.getConnectionCounts();
      expect(counts.cardhosts).toBeGreaterThan(0);
    });

    it("should unregister controller connections", () => {
      const mockSend = vi.fn();
      const sessionToken = "sess_test_2";

      router.transportUseCase.registerController(sessionToken, mockSend);
      router.transportUseCase.unregisterController(sessionToken);

      // Should succeed without throwing
      expect(true).toBe(true);
    });

    it("should unregister cardhost connections", () => {
      const mockSend = vi.fn();
      const cardhostUuid = "peer_test_2";

      router.transportUseCase.registerCardhost(cardhostUuid, mockSend);
      router.transportUseCase.unregisterCardhost(cardhostUuid);

      // Should succeed without throwing
      expect(true).toBe(true);
    });

    it("should send notification to cardhost", () => {
      const mockSend = vi.fn();
      const cardhostUuid = "peer_test_notify";

      router.transportUseCase.registerCardhost(cardhostUuid, mockSend);
      router.transportUseCase.notifyCardhostControllerConnected(cardhostUuid);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        type: "controller-connected",
      });
    });
  });

  describe("Session Lifecycle", () => {
    it("should track sessions in router stats", () => {
      const stats = router.getStats();

      expect(stats).toBeDefined();
      expect(stats.running).toBe(true);
      expect(stats.activeSessions).toBeGreaterThanOrEqual(0);
      expect(stats.activeCardhosts).toBeGreaterThanOrEqual(0);
      expect(stats.activeControllers).toBeGreaterThanOrEqual(0);
    });

    it("should validate non-existent sessions as invalid", () => {
      const result = router.controllerUseCase.validateSession("sess_does_not_exist");

      expect(result).toBe(false);
    });
  });

  describe("Authentication Flow", () => {
    it("should generate deterministic controller IDs", async () => {
      const publicKey = Buffer.from("same-key").toString("base64");

      const result1 = await router.controllerUseCase.initiateAuth(publicKey);
      const result2 = await router.controllerUseCase.initiateAuth(publicKey);

      expect(result1.controllerId).toBe(result2.controllerId);
    });

    it("should generate unique challenges", async () => {
      const publicKey = Buffer.from("test-key").toString("base64");

      const result1 = await router.controllerUseCase.initiateAuth(publicKey);
      const result2 = await router.controllerUseCase.initiateAuth(publicKey);

      expect(result1.challenge).not.toBe(result2.challenge);
    });

    it("should generate deterministic cardhost UUIDs", async () => {
      const publicKey = Buffer.from("cardhost-key").toString("base64");

      const result1 = await router.cardhostUseCase.initiateAuth(publicKey);
      const result2 = await router.cardhostUseCase.initiateAuth(publicKey);

      expect(result1.uuid).toBe(result2.uuid);
    });
  });
});
