/**
 * Configuration Manager for Cardhost
 * Handles UUID persistence, keypair management, and config file operations
 *
 * Spec: docs/what-to-make.md Section 3.2.3 - UUID管理
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const crypto = globalThis.crypto;
import { toBase64 } from "@remote-apdu/shared";


export interface CardHostPersistedConfig {
  uuid: string; // Router-derived UUID (peer_<hash>)
  signingPublicKey: string;
  signingPrivateKey: string;
  routerUrl: string;
  createdAt: string;
  uuidSource: "router-derived" | "legacy"; // Track UUID origin
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
   * Create new configuration with Ed25519 keypair
   * NOTE: UUID is NOT generated here - it will be derived by Router from public key
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

    // Temporary placeholder UUID - will be replaced by Router-derived UUID on first auth
    const placeholderUuid = "pending-router-derivation";

    this.config = {
      uuid: placeholderUuid,
      signingPublicKey,
      signingPrivateKey,
      routerUrl:
        routerUrl ??
        ((typeof (globalThis as any).process !== "undefined" &&
          (globalThis as any).process?.env?.ROUTER_URL) ??
          "http://localhost:3000"),
      createdAt: new Date().toISOString(),
      uuidSource: "router-derived",
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

    // Validate UUID format based on source
    if (config.uuidSource === "router-derived" || config.uuid.startsWith("peer_")) {
      // Router-derived UUID format: peer_<base64url>
      if (!/^peer_[A-Za-z0-9_-]+$/.test(config.uuid) && config.uuid !== "pending-router-derivation") {
        throw new Error(`Invalid Router-derived UUID format: ${config.uuid}`);
      }
    } else {
      // Legacy UUID v4 format (backward compatibility)
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          config.uuid,
        )
      ) {
        throw new Error("Invalid UUID format");
      }
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

  /**
   * Update UUID with Router-derived value
   * Called after successful authentication when Router returns derived UUID
   */
  async updateUuid(derivedUuid: string): Promise<void> {
    if (!this.config) {
      throw new Error("Config not loaded");
    }

    // Only update if current UUID is placeholder or different
    if (
      this.config.uuid === "pending-router-derivation" ||
      this.config.uuid !== derivedUuid
    ) {
      this.config.uuid = derivedUuid;
      this.config.uuidSource = "router-derived";
      this.save();
    }
  }
}
