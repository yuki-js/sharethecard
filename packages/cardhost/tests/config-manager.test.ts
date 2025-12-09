/**
 * Unit tests for ConfigManager
 *
 * Tests UUID persistence, keypair management, and config file operations
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../src/lib/config-manager.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ConfigManager", () => {
  let testDir: string;
  let testConfigFile: string;
  let manager: ConfigManager;

  beforeEach(() => {
    // Create temporary directory for testing
    testDir = join(tmpdir(), `cardhost-test-${Date.now()}`);
    testConfigFile = join(testDir, "config.json");

    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    manager = new ConfigManager(testConfigFile, testDir);
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Configuration Creation", () => {
    it("should create new config with UUID and keypair", async () => {
      const config = await manager.loadOrCreate("http://test-router.com");

      expect(config).toHaveProperty("uuid");
      expect(config).toHaveProperty("signingPublicKey");
      expect(config).toHaveProperty("signingPrivateKey");
      expect(config).toHaveProperty("routerUrl");
      expect(config).toHaveProperty("createdAt");
    });

    it("should generate valid UUID v4", async () => {
      const config = await manager.loadOrCreate();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(config.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("should generate Ed25519 keypair in base64", async () => {
      const config = await manager.loadOrCreate();

      expect(config.signingPublicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(config.signingPrivateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(config.signingPublicKey.length).toBeGreaterThan(40);
      expect(config.signingPrivateKey.length).toBeGreaterThan(40);
    });

    it("should save config to file", async () => {
      await manager.loadOrCreate();

      expect(existsSync(testConfigFile)).toBe(true);
    });

    it("should use provided router URL", async () => {
      const testUrl = "http://custom-router.example.com";
      const config = await manager.loadOrCreate(testUrl);

      expect(config.routerUrl).toBe(testUrl);
    });

    it("should use environment variable if no URL provided", async () => {
      const originalEnv = process.env.ROUTER_URL;
      process.env.ROUTER_URL = "http://env-router.com";

      const config = await manager.loadOrCreate();

      expect(config.routerUrl).toBe("http://env-router.com");

      // Restore
      if (originalEnv) {
        process.env.ROUTER_URL = originalEnv;
      } else {
        delete process.env.ROUTER_URL;
      }
    });
  });

  describe("Configuration Loading", () => {
    it("should load existing config from file", async () => {
      // Create config first
      const original = await manager.loadOrCreate("http://test.com");

      // Create new manager and load same config
      const manager2 = new ConfigManager(testConfigFile, testDir);
      const loaded = await manager2.loadOrCreate();

      expect(loaded.uuid).toBe(original.uuid);
      expect(loaded.signingPublicKey).toBe(original.signingPublicKey);
      expect(loaded.signingPrivateKey).toBe(original.signingPrivateKey);
    });

    it("should return cached config on subsequent calls", async () => {
      const config1 = await manager.loadOrCreate();
      const config2 = await manager.loadOrCreate();

      // Should return same instance
      expect(config1).toBe(config2);
    });
  });

  describe("UUID Persistence", () => {
    it("should maintain same UUID across restarts", async () => {
      const config1 = await manager.loadOrCreate();
      const uuid1 = config1.uuid;

      // Simulate restart: create new manager
      const manager2 = new ConfigManager(testConfigFile, testDir);
      const config2 = await manager2.loadOrCreate();

      expect(config2.uuid).toBe(uuid1);
    });

    it("should maintain same keypair across restarts", async () => {
      const config1 = await manager.loadOrCreate();
      const publicKey1 = config1.signingPublicKey;

      // Simulate restart
      const manager2 = new ConfigManager(testConfigFile, testDir);
      const config2 = await manager2.loadOrCreate();

      expect(config2.signingPublicKey).toBe(publicKey1);
      expect(config2.signingPrivateKey).toBe(config1.signingPrivateKey);
    });
  });

  describe("UUID Retrieval", () => {
    it("should get UUID after config loaded", async () => {
      await manager.loadOrCreate();
      const uuid = manager.getUuid();

      expect(uuid).toMatch(/^[0-9a-f-]+$/i);
    });

    it("should throw error if config not loaded", () => {
      expect(() => manager.getUuid()).toThrow("not loaded");
    });

    it("should get full config", async () => {
      await manager.loadOrCreate("http://test.com");
      const config = manager.getConfig();

      expect(config).toHaveProperty("uuid");
      expect(config).toHaveProperty("signingPublicKey");
    });
  });

  describe("Router URL Update", () => {
    it("should update router URL", async () => {
      await manager.loadOrCreate("http://original.com");

      await manager.updateRouterUrl("http://updated.com");

      const config = manager.getConfig();
      expect(config.routerUrl).toBe("http://updated.com");
    });

    it("should persist URL update to file", async () => {
      await manager.loadOrCreate("http://original.com");
      await manager.updateRouterUrl("http://updated.com");

      // Load with new manager
      const manager2 = new ConfigManager(testConfigFile, testDir);
      const config = await manager2.loadOrCreate();

      expect(config.routerUrl).toBe("http://updated.com");
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in router URL", async () => {
      const specialUrl = "https://router.example.com:8443/path?param=value";
      const config = await manager.loadOrCreate(specialUrl);

      expect(config.routerUrl).toBe(specialUrl);
    });

    it("should generate unique UUIDs for different configs", async () => {
      const config1 = await manager.loadOrCreate();

      // Create second manager with different file
      const testFile2 = join(testDir, "config2.json");
      const manager2 = new ConfigManager(testFile2, testDir);
      const config2 = await manager2.loadOrCreate();

      expect(config1.uuid).not.toBe(config2.uuid);
    });
  });
});
