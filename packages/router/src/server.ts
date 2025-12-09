#!/usr/bin/env node
/**
 * Router Server
 * HTTP/WebSocket server that can be started in-process for testing or standalone
 * This integrates the Router library with Hono HTTP framework and WebSocket
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { Router } from "./router.js";
import { createControllerRoutes } from "./presentation/rest/controller-routes.js";
import { createCardhostRoutes } from "./presentation/rest/cardhost-routes.js";
import { handleControllerWebSocket } from "./presentation/ws/controller-ws.js";
import { handleCardhostWebSocket } from "./presentation/ws/cardhost-ws.js";

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
  server: ReturnType<typeof serve>;
  wss: WebSocketServer;
  stop: () => Promise<void>;
}> {
  const port = config.port ?? Number(process.env.PORT ?? 3000);
  const host = config.host ?? process.env.HOST ?? "0.0.0.0";

  // Create router instance
  const router = new Router();
  await router.start();

  // Create Hono app
  const app = new Hono();

  // Mount controller routes
  const controllerRoutes = createControllerRoutes(
    router.controllerUseCase,
    router.cardhostUseCase,
  );
  app.route("/", controllerRoutes);

  // Mount cardhost routes
  const cardhostRoutes = createCardhostRoutes(router.cardhostUseCase);
  app.route("/", cardhostRoutes);

  // Stats endpoint
  app.get("/stats", (c) => {
    const stats = router.getStats();
    return c.json(stats);
  });

  // Health check
  app.get("/health", (c) => {
    return c.json({ ok: true, running: router.isRunning() });
  });

  console.log("Starting Router Server...");
  console.log(`Listening on http://${host}:${port}`);

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ server: server as any });

  wss.on("connection", (ws, req) => {
    const url = req.url || "";

    // Separate paths for controller and cardhost WebSocket connections
    if (url.startsWith("/ws/controller")) {
      const controllerId = String(req.headers["x-controller-id"] ?? "");
      const sessionToken = String(req.headers["x-session-token"] ?? "");
      handleControllerWebSocket(
        ws,
        controllerId,
        sessionToken,
        router.controllerUseCase,
        router.transportUseCase,
      );
    } else if (url.startsWith("/ws/cardhost")) {
      const cardhostUuid = String(req.headers["x-cardhost-uuid"] ?? "");
      handleCardhostWebSocket(
        ws,
        cardhostUuid,
        router.cardhostUseCase,
        router.transportUseCase,
      );
    } else {
      try {
        ws.close(1008, "Invalid WebSocket path");
      } catch {}
    }
  });

  return {
    router,
    server,
    wss,
    async stop() {
      try {
        wss.close();
      } catch {}
      await router.stop();
      try {
        server.close();
      } catch {}
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