/**
 * Configuration Manager for Cardhost
 * Handles keypair management and config file operations
 *
 * Spec: docs/what-to-make.md Section 3.2.3 - UUID管理（deprecated: Cardhost does not know UUID）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const crypto = globalThis.crypto;
import { toBase64 } from "@remote-apdu/shared";

export interface CardHostPersistedConfig {
  signingPublicKey: string;
  signingPrivateKey: string;
  routerUrl: string;
  createdAt: string;
}

const CONFIG_DIR = join(homedir(), ".cardhost");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Manages Cardhost configuration (without UUID)
 * Ensures keypair survives restarts
 */
export class ConfigManager {
  private config: CardHostPersistedConfig | null = null;

  constructor(
    private configPath: string = CONFIG_FILE,
    private configDir: string = CONFIG_DIR,
  ) {}

  /**
   * Load existing config or create new one
   * Keypair is generated once and persisted
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
      // Allow extra fields in legacy configs (e.g., uuid), ignore them
      const parsed = JSON.parse(content) as any;

      const config: CardHostPersistedConfig = {
        signingPublicKey: parsed.signingPublicKey,
        signingPrivateKey: parsed.signingPrivateKey,
        routerUrl: parsed.routerUrl,
        createdAt: parsed.createdAt,
      };

      this.validateConfig(config);

      this.config = config;
      return this.config;
    } catch (error) {
      throw new Error(
        `Failed to load config from ${this.configPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Create new configuration with Ed25519 keypair
   */
  private async createNew(
    routerUrl?: string,
  ): Promise<CardHostPersistedConfig> {
    // Generate Ed25519 keypair for signing (Cardhost authentication)
    const keyPair = (await crypto.subtle.generateKey(
      { name: "Ed25519" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;

    // Export keys in SPKI/PKCS8 format
    const publicKeySpki = await crypto.subtle.exportKey(
      "spki",
      keyPair.publicKey,
    );
    const privateKeyPkcs8 = await crypto.subtle.exportKey(
      "pkcs8",
      keyPair.privateKey,
    );

    const signingPublicKey = toBase64(new Uint8Array(publicKeySpki));
    const signingPrivateKey = toBase64(new Uint8Array(privateKeyPkcs8));

    this.config = {
      signingPublicKey,
      signingPrivateKey,
      routerUrl:
        routerUrl ??
        ((typeof (globalThis as any).process !== "undefined" &&
          (globalThis as any).process?.env?.ROUTER_URL) ??
          "http://localhost:3000"),
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
    if (!config.signingPublicKey || !config.signingPrivateKey) {
      throw new Error("Invalid config: missing required fields");
    }
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
