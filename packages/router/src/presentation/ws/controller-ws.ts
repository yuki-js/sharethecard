/**
 * Controller WebSocket Handler
 * Handles WebSocket connections from controllers
 * 
 * IMPORTANT: Controllers must be authenticated before WebSocket connection.
 * Authentication is separate from session identification.
 */

import type { WebSocket } from "ws";
import { ControllerUseCase } from "../../usecase/controller-usecase.js";
import { TransportUseCase } from "../../usecase/transport-usecase.js";

export function handleControllerWebSocket(
  ws: WebSocket,
  controllerId: string,
  sessionToken: string,
  controllerUseCase: ControllerUseCase,
  transportUseCase: TransportUseCase,
): void {
  // Validate controller is authenticated
  if (!controllerUseCase.isAuthenticated(controllerId)) {
    try {
      ws.close(1008, "Controller not authenticated");
    } catch {}
    return;
  }

  // Validate session token
  if (!controllerUseCase.validateSession(sessionToken)) {
    try {
      ws.close(1008, "Invalid session token");
    } catch {}
    return;
  }

  // Verify session belongs to this controller
  const sessionController = controllerUseCase.getControllerForSession(sessionToken);
  if (sessionController !== controllerId) {
    try {
      ws.close(1008, "Session does not belong to this controller");
    } catch {}
    return;
  }

  // Register connection
  transportUseCase.registerController(sessionToken, (data: unknown) => {
    try {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
    } catch {}
  });

  // Handle incoming messages
  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString("utf8"));
      
      // Relay to cardhost (payload-agnostic, just forward)
      const response = await transportUseCase.relayFromController(
        sessionToken,
        message,
      );
      
      // Send response back to controller
      ws.send(JSON.stringify(response));
    } catch (error) {
      // Send error response
      ws.send(
        JSON.stringify({
          error: {
            code: "RELAY_ERROR",
            message: (error as Error).message,
          },
        }),
      );
    }
  });

  // Handle disconnection
  ws.on("close", () => {
    transportUseCase.unregisterController(sessionToken);
  });

  ws.on("error", () => {
    transportUseCase.unregisterController(sessionToken);
  });
}