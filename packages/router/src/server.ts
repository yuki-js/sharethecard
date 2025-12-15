#!/usr/bin/env node
/**
 * Router Server
 * HTTP/WebSocket server (WebSocket only, HTTP for /health and /stats)
 * Can be started in-process for testing or standalone
 */

import { createServer } from "node:http";

import { createLogger } from "@remote-apdu/shared";
import { WebSocketServer } from "ws";

import { handleCardhostWebSocket } from "./presentation/ws/cardhost-ws.js";
import { handleControllerWebSocket } from "./presentation/ws/controller-ws.js";
import { Router } from "./router.js";

const logger = createLogger("router:server");

export interface ServerConfig {
  port?: number;
  host?: string;
}

/**
 * Start Router HTTP/WebSocket server
 * Can be called programmatically for testing or from CLI
 */
export async function startServer(
  config: ServerConfig = {},
): Promise<{
  router: Router;
  server: ReturnType<typeof createServer>;
  wss: WebSocketServer;
  stop: () => Promise<void>;
}> {
  const port = config.port ?? Number(process.env.PORT ?? 3000);
  const host = config.host ?? process.env.HOST ?? "0.0.0.0";

  // Create router instance
  const router = new Router();
  await router.start();

  // Create HTTP server
  const httpServer = createServer((req, res) => {
    // /health endpoint
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, running: router.isRunning() }));
      return;
    }

    // /stats endpoint
    if (req.url === "/stats" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(router.getStats()));
      return;
    }

    // All other paths 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  console.log("Starting Router Server...");
  console.log(`Listening on http://${host}:${port}`);

  // Create WebSocket server
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws, req) => {
    const url = req.url || "";

    // Separate paths for controller and cardhost WebSocket connections
    if (url.startsWith("/ws/controller")) {
      await handleControllerWebSocket(ws, router);
    } else if (url.startsWith("/ws/cardhost")) {
      await handleCardhostWebSocket(ws, req, router);
    } else {
      try {
        ws.close(1008, "Invalid WebSocket path");
      } catch {}
    }
  });

  wss.on("error", (err) => {
    logger.error("WebSocket server error", err as Error);
  });

  // Start listening
  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      logger.info("Router server listening", { host, port });
      resolve();
    });
  });

  return {
    router,
    server: httpServer,
    wss,
    async stop() {
      try {
        wss.close();
      } catch {}
      await router.stop();
      return new Promise<void>((resolve) => {
        httpServer.close(() => {
          logger.info("Router server stopped");
          resolve();
        });
      });
    },
  };
}

/**
 * Main entry point for CLI execution
 */
async function main(): Promise<void> {
  const runtime = await startServer();

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down Router...");
    await runtime.stop();
    console.log("✓ Stopped");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start server if executed directly (not in test environment)
if (!process.env.VITEST && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
