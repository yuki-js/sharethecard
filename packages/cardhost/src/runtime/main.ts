#!/usr/bin/env node
/**
 * Cardhost Runtime - Standalone Service
 * Thin wrapper around CardhostService library
 *
 * This is the "下駄" (runtime wrapper) that makes the library work as standalone service
 * Spec: docs/what-to-make.md Section 3.5 - 共通項
 */

import {
  CardhostService,
  ConfigManager,
  MockSmartCardPlatform,
} from "../lib/index.js";

import { PcscPlatformManager } from "@aokiapp/jsapdu-pcsc";

/**
 * Parse command line arguments
 */
function parseArgs(): { routerUrl: string; useMock: boolean } {
  const args = process.argv.slice(2);
  let routerUrl = process.env.ROUTER_URL ?? "http://localhost:3000";
  let useMock = process.env.USE_MOCK === "true";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--router" && args[i + 1]) {
      routerUrl = args[i + 1];
      i++;
    } else if (args[i] === "--mock") {
      useMock = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Cardhost Service - Remote APDU Communication System

Usage: cardhost [options]

Options:
  --router <url>    Router URL (default: http://localhost:3000 or $ROUTER_URL)
  --mock            Use mock platform instead of real card reader
  --help, -h        Show this help message

Environment Variables:
  ROUTER_URL        Router URL
  USE_MOCK          Set to 'true' to use mock platform

Configuration:
  Config file: ~/.cardhost/config.json
  Contains: UUID, Ed25519 keypair, router URL

The service will:
1. Load or create UUID and keypair
2. Authenticate with Router via challenge-response
3. Start serving APDU requests from Controllers
4. Auto-reconnect on connection loss
`);
      process.exit(0);
    }
  }

  return { routerUrl, useMock };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { routerUrl, useMock } = parseArgs();

  console.log("Starting Cardhost Service...");
  console.log(`Router URL: ${routerUrl}`);
  console.log(`Platform: ${useMock ? "Mock" : "PC/SC"}`);

  // Create service with optional mock platform
  const platform = useMock
    ? new MockSmartCardPlatform()
    : PcscPlatformManager.getInstance().getPlatform();

  const service = new CardhostService({
    routerUrl,
    platform,
    configManager: new ConfigManager(),
  });

  // Connect to Router
  try {
    await service.connect();
    console.log(`✓ Connected to Router`);
    console.log(`✓ Cardhost UUID: ${service.getUuid()}`);
    console.log(`✓ Ready to serve APDU requests`);
  } catch (error) {
    console.error("Failed to connect:", (error as Error).message);
    process.exit(1);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down Cardhost...");
    await service.disconnect();
    console.log("✓ Disconnected");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down Cardhost...");
    await service.disconnect();
    process.exit(0);
  });

  // Keep process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
