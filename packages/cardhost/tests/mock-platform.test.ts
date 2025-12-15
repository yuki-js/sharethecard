/**
 * Unit tests for MockSmartCardPlatform
 *
 * Validates that mock implementation follows jsapdu-interface patterns correctly
 * Tests resource management with await using pattern
 *
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { CommandApdu } from "@aokiapp/jsapdu-interface";
import { describe, it, expect, beforeEach } from "vitest";

import { MockSmartCardPlatform } from "../src/lib/mock-platform.js";

describe("MockSmartCardPlatform", () => {
  describe("Initialization", () => {
    it("should initialize successfully", async () => {
      const platform = new MockSmartCardPlatform();

      expect(platform.isInitialized()).toBe(false);

      await platform.init();

      expect(platform.isInitialized()).toBe(true);
    });

    it("should throw error when initializing twice without force", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      await expect(platform.init()).rejects.toThrow("already initialized");
    });

    it("should allow re-initialization with force flag", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();
      await platform.init(true); // Should not throw

      expect(platform.isInitialized()).toBe(true);
    });

    it("should create default mock device on init", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();

      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe("mock-device-1");
      expect(devices[0].supportsApdu).toBe(true);
    });
  });

  describe("Resource Management with await using", () => {
    it("should support await using pattern", async () => {
      await using platform = new MockSmartCardPlatform();
      await platform.init();

      expect(platform.isInitialized()).toBe(true);
      // Cleanup happens automatically
    });

    it("should cleanup on scope exit", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        await using _p = platform;
        expect(platform.isInitialized()).toBe(true);
      }

      // Platform should be released after scope exit
      expect(platform.isInitialized()).toBe(false);
    });
  });

  describe("Device Operations", () => {
    let platform: MockSmartCardPlatform;

    beforeEach(async () => {
      platform = new MockSmartCardPlatform();
      await platform.init();
    });

    it("should acquire device by ID", async () => {
      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);

      expect(device).toBeDefined();
      expect(device.getDeviceInfo().id).toBe(devices[0].id);
    });

    it("should throw error for non-existent device", async () => {
      await expect(platform.acquireDevice("non-existent-id")).rejects.toThrow(
        "Device not found",
      );
    });

    it("should support multiple mock devices", async () => {
      platform.addMockDevice("mock-device-2", "Second Reader");

      const devices = await platform.getDeviceInfo();

      expect(devices).toHaveLength(2);
      expect(devices[1].id).toBe("mock-device-2");
    });
  });

  describe("Card Session Operations", () => {
    let platform: MockSmartCardPlatform;

    beforeEach(async () => {
      platform = new MockSmartCardPlatform();
      await platform.init();
    });

    it("should start card session with await using", async () => {
      const devices = await platform.getDeviceInfo();
      await using device = await platform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      expect(card).toBeDefined();

      const atr = await card.getAtr();
      expect(atr).toBeInstanceOf(Uint8Array);
      expect(atr.length).toBeGreaterThan(0);
    });

    it("should transmit APDU command and return success", async () => {
      const devices = await platform.getDeviceInfo();
      await using device = await platform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // SELECT with AID
      const command = new CommandApdu(
        0x00, 0xa4, 0x04, 0x00,
        new Uint8Array([0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00]),
        null
      );
      const response = await card.transmit(command);

      expect(response.sw1).toBe(0x90);
      expect(response.sw2).toBe(0x00);
      expect(response.sw).toBe(0x9000);
    });

    it("should transmit raw APDU bytes", async () => {
      const devices = await platform.getDeviceInfo();
      await using device = await platform.acquireDevice(devices[0].id);
      await using card = await device.startSession();

      // SELECT with AID as raw bytes
      const rawCommand = new Uint8Array([
        0x00, 0xa4, 0x04, 0x00, 0x08,
        0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00
      ]);
      const response = await card.transmit(rawCommand);

      expect(response).toBeInstanceOf(Uint8Array);
      expect(response.length).toBeGreaterThanOrEqual(2);
      expect(response[response.length - 2]).toBe(0x90);
      expect(response[response.length - 1]).toBe(0x00);
    });
  });

  describe("Custom Response Configuration", () => {
    it("should allow setting custom responses for testing", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      await using device = await platform.acquireDevice(devices[0].id);
      
      // Set custom response for a specific command
      platform.setDeviceResponse(
        devices[0].id,
        "00A4000002FFFF", // SELECT non-existent file
        new Uint8Array([0x6A, 0x82]) // File not found
      );

      await using card = await device.startSession();
      const response = await card.transmit(
        new CommandApdu(0x00, 0xa4, 0x00, 0x00, new Uint8Array([0xFF, 0xFF]), null)
      );

      expect(response.sw).toBe(0x6A82);
    });
  });

  describe("Card Presence Simulation", () => {
    it("should detect card as present by default", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);

      const isPresent = await device.isCardPresent();
      expect(isPresent).toBe(true);
    });

    it("should allow controlling card presence", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);

      platform.setCardPresent(devices[0].id, false);

      const isPresent = await device.isCardPresent();
      expect(isPresent).toBe(false);
    });

    it("should wait for card presence", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);

      // Card already present - should resolve immediately
      await expect(device.waitForCardPresence(1000)).resolves.toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should throw error when operating on uninitialized platform", async () => {
      const platform = new MockSmartCardPlatform();

      await expect(platform.getDeviceInfo()).rejects.toThrow("not initialized");
    });

    it("should throw error when starting session twice", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);

      await device.startSession();

      await expect(device.startSession()).rejects.toThrow("already active");
    });

    it("should throw error when transmitting on released card", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);
      const card = await device.startSession();

      await card.release();

      const command = new CommandApdu(0x00, 0xa4, 0x04, 0x00, null, null);

      await expect(card.transmit(command)).rejects.toThrow("released");
    });
  });

  describe("Release and Cleanup", () => {
    it("should release platform successfully", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      await platform.release();

      expect(platform.isInitialized()).toBe(false);
    });

    it("should release all devices on platform release", async () => {
      const platform = new MockSmartCardPlatform();
      await platform.init();

      const devices = await platform.getDeviceInfo();
      const device = await platform.acquireDevice(devices[0].id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const card = await device.startSession();

      await platform.release();

      // Further operations should fail
      await expect(platform.getDeviceInfo()).rejects.toThrow();
    });
  });
});
