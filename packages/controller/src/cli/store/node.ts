import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { IKeyStore } from "../../core/store/interface.js";

const DEFAULT_KEY_DIR = join(homedir(), ".controller");

/**
 * A key-value store implementation that uses the Node.js filesystem.
 * It stores each key as a separate file in a specified directory.
 */
export class NodeKeyStore implements IKeyStore {
  private readonly keyDir: string;

  constructor(keyDir: string = DEFAULT_KEY_DIR) {
    this.keyDir = keyDir;
    this.ensureKeyDir();
  }

  private ensureKeyDir(): void {
    if (!existsSync(this.keyDir)) {
      // Create with 0o700 permissions (owner read/write/execute, no access for group/others)
      mkdirSync(this.keyDir, { recursive: true, mode: 0o700 });
    }
  }

  private getPathForKey(key: string): string {
    // Basic sanitization to prevent directory traversal
    if (key.includes("..") || key.includes("/") || key.includes("\\")) {
      throw new Error("Invalid key format.");
    }
    return join(this.keyDir, key);
  }

  async save(key: string, data: string): Promise<void> {
    const filePath = this.getPathForKey(key);
    // Set file permissions to 0o600 (owner read/write) for private keys
    const mode = key.endsWith(".pub") ? 0o644 : 0o600;
    await fs.writeFile(filePath, data, { encoding: "utf8", mode });
  }

  async load(key: string): Promise<string | null> {
    const filePath = this.getPathForKey(key);
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error: any) {
      // If the file doesn't exist, return null. Otherwise, re-throw.
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.getPathForKey(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
