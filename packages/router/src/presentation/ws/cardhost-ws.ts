/**
 * Cardhost WebSocket Handler
 * Handles WebSocket connections from cardhosts
 */

import type { WebSocket } from "ws";
import { CardhostUseCase } from "../../usecase/cardhost-usecase.js";
import { TransportUseCase } from "../../usecase/transport-usecase.js";

export function handleCardhostWebSocket(
  ws: WebSocket,
  cardhostUuid: string,
  cardhostUseCase: CardhostUseCase,
  transportUseCase: TransportUseCase,
): void {
  // Validate cardhost is authenticated
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