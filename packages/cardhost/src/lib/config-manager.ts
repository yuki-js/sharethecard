/**
 * Configuration Manager for Cardhost
 * Handles UUID persistence, keypair management, and config file operations
 *
 * Spec: docs/what-to-make.md Section 3.2.3 - UUID管理
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { generateUuidV4 } from "@remote-apdu/shared";

export interface CardHostPersistedConfig {
  uuid: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  routerUrl: string;
  createdAt: string;
}

const CONFIG_DIR = join(homedir(), ".cardhost");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Manages Cardhost configuration and UUID persistence
 * Ensures UUID and keypair survive restarts
 */
export class ConfigManager {
  private config: CardHostPersistedConfig | null = null;

  constructor(
    private configPath: string = CONFIG_FILE,
    private configDir: string = CONFIG_DIR,
  ) {}

  /**
   * Load existing config or create new one
   * UUID and keypair are generated once and persisted
   */
  async loadOrCreate(
    defaultRouterUrl?: string,
  ): Promise<CardHostPersistedConfig> {
    if (this.config) {
      return this.config;
    }

    this.ensureConfigDir();

    if (existsSync(this.configPath)) {
      return this.loadExisting();
    }

    return this.createNew(defaultRouterUrl);
  }

  /**
   * Load existing configuration from file
   */
  private loadExisting(): CardHostPersistedConfig {
    try {
      const content = readFileSync(this.configPath, "utf8");
      this.config = JSON.parse(content) as CardHostPersistedConfig;

      this.validateConfig(this.config);

      return this.config;
    } catch (error) {
      throw new Error(
        `Failed to load config from ${this.configPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Create new configuration with UUID and Ed25519 keypair
   */
  private async createNew(
    routerUrl?: string,
  ): Promise<CardHostPersistedConfig> {
    const uuid = generateUuidV4();

    // Generate Ed25519 keypair for signing (Cardhost authentication)
    const keyPair = (await webcrypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    // Export keys in SPKI/PKCS8 format
    const publicKeySpki = await webcrypto.subtle.exportKey(
      "spki",
      keyPair.publicKey,
    );
    const privateKeyPkcs8 = await webcrypto.subtle.exportKey(
      "pkcs8",
      keyPair.privateKey,
    );

    const signingPublicKey = Buffer.from(publicKeySpki).toString("base64");
    const signingPrivateKey = Buffer.from(privateKeyPkcs8).toString("base64");

    this.config = {
      uuid,
      signingPublicKey,
      signingPrivateKey,
      routerUrl: routerUrl ?? process.env.ROUTER_URL ?? "http://localhost:3000",
      createdAt: new Date().toISOString(),
    };

    this.save();

    return this.config;
  }

  /**
   * Save current configuration to file
   */
  private save(): void {
    if (!this.config) {
      throw new Error("No config to save");
    }

    try {
      const content = JSON.stringify(this.config, null, 2);
      writeFileSync(this.configPath, content, { mode: 0o600 }); // Restrict permissions
    } catch (error) {
      throw new Error(
        `Failed to save config to ${this.configPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Ensure config directory exists
   */
  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Validate config structure
   */
  private validateConfig(config: CardHostPersistedConfig): void {
    if (!config.uuid || !config.signingPublicKey || !config.signingPrivateKey) {
      throw new Error("Invalid config: missing required fields");
    }

    // Validate UUID format
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        config.uuid,
      )
    ) {
      throw new Error("Invalid UUID format");
    }
  }

  /**
   * Get current UUID
   */
  getUuid(): string {
    if (!this.config) {
      throw new Error("Config not loaded. Call loadOrCreate() first.");
    }
    return this.config.uuid;
  }

  /**
   * Get current config
   */
  getConfig(): CardHostPersistedConfig {
    if (!this.config) {
      throw new Error("Config not loaded. Call loadOrCreate() first.");
    }
    return this.config;
  }

  /**
   * Update router URL
   */
  async updateRouterUrl(routerUrl: string): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    this.config.routerUrl = routerUrl;
    this.save();
  }
}
