/**
 * Unit tests for ConfigManager
 *
 * Tests UUID persistence, keypair management, and config file operations
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ConfigManager } from "../src/lib/config-manager.js";


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
    it("should create new config with keypair and router URL (no UUID)", async () => {
      const config = await manager.loadOrCreate("http://test-router.com");

      expect(config).not.toHaveProperty("uuid");
      expect(config).toHaveProperty("signingPublicKey");
      expect(config).toHaveProperty("signingPrivateKey");
      expect(config).toHaveProperty("routerUrl");
      expect(config).toHaveProperty("createdAt");
    });

    it("should not include UUID placeholder in config", async () => {
      const config = await manager.loadOrCreate();

      expect(config).not.toHaveProperty("uuid");
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

      expect(loaded.signingPublicKey).toBe(original.signingPublicKey);
      expect(loaded.signingPrivateKey).toBe(original.signingPrivateKey);
      expect(loaded.routerUrl).toBe(original.routerUrl);
    });

    it("should return cached config on subsequent calls", async () => {
      const config1 = await manager.loadOrCreate();
      const config2 = await manager.loadOrCreate();

      // Should return same instance
      expect(config1).toBe(config2);
    });
  });

  describe("UUID Persistence", () => {
    it("should not include UUID across restarts", async () => {
      const config1 = await manager.loadOrCreate();

      // Simulate restart: create new manager
      const manager2 = new ConfigManager(testConfigFile, testDir);
      const config2 = await manager2.loadOrCreate();

      expect(config1).not.toHaveProperty("uuid");
      expect(config2).not.toHaveProperty("uuid");
    });
  });
  describe("Keypair Persistence", () => {
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

  describe("Config Retrieval", () => {
    it("should get config after load", async () => {
      await manager.loadOrCreate();
      const cfg = manager.getConfig();

      expect(cfg).toHaveProperty("signingPublicKey");
      expect(cfg).toHaveProperty("signingPrivateKey");
    });

    it("should throw error if config not loaded", () => {
      const newManager = new ConfigManager(testConfigFile, testDir);
      expect(() => newManager.getConfig()).toThrow("not loaded");
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

    it("should generate unique keypairs for different configs", async () => {
      const config1 = await manager.loadOrCreate();

      // Create second manager with different file
      const testFile2 = join(testDir, "config2.json");
      const manager2 = new ConfigManager(testFile2, testDir);
      const config2 = await manager2.loadOrCreate();

      // Keypairs should be unique (not UUIDs - those are derived by Router)
      expect(config1.signingPublicKey).not.toBe(config2.signingPublicKey);
      expect(config1.signingPrivateKey).not.toBe(config2.signingPrivateKey);
    });
  });
});
