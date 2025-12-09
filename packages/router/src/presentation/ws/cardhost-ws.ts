/**
 * Cardhost WebSocket Handler
 * Handles WebSocket connections from cardhosts
 *
 * SECURITY: Cardhost is identified by session token, not by self-declared UUID
 */

import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { CardhostUseCase } from "../../usecase/cardhost-usecase.js";
import { TransportUseCase } from "../../usecase/transport-usecase.js";

export function handleCardhostWebSocket(
  ws: WebSocket,
  req: IncomingMessage,
  cardhostUseCase: CardhostUseCase,
  transportUseCase: TransportUseCase,
): void {
  // SECURITY: Get session token from header (issued after authentication)
  const sessionToken = String(req.headers["x-cardhost-session"] ?? "");
  
  if (!sessionToken) {
    try {
      ws.close(1008, "Missing session token");
    } catch {}
    return;
  }

  // Validate session and get UUID from Router's records
  const cardhostUuid = cardhostUseCase.getUuidBySession(sessionToken);
  
  if (!cardhostUuid) {
    try {
      ws.close(1008, "Invalid or expired session");
    } catch {}
    return;
  }

  // Double-check authentication status
  if (!cardhostUseCase.isConnected(cardhostUuid)) {
    try {
      ws.close(1008, "Cardhost not authenticated");
    } catch {}
    return;
  }

  // Register connection
  transportUseCase.registerCardhost(cardhostUuid, (data: unknown) => {
    try {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
    } catch {}
  });

  // Handle incoming messages (responses from cardhost)
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString("utf8"));
      
      // Handle incoming data (for request/response correlation)
      transportUseCase.handleCardhostData(cardhostUuid, message);
    } catch {
      // Ignore malformed messages
    }
  });

  // Handle disconnection
  ws.on("close", () => {
    transportUseCase.unregisterCardhost(cardhostUuid);
    cardhostUseCase.disconnect(cardhostUuid);
  });

  ws.on("error", () => {
    transportUseCase.unregisterCardhost(cardhostUuid);
    cardhostUseCase.disconnect(cardhostUuid);
  });
}