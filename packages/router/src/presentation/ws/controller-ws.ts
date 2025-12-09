/**
 * Controller WebSocket Handler
 * Handles WebSocket connections from controllers with message-based authentication
 * 
 * Flow:
 * 1. auth-init: Controller sends public key
 * 2. auth-challenge: Router sends Controller ID + challenge
 * 3. auth-verify: Controller sends signature
 * 4. auth-success: Router confirms authentication
 * 5. connect-cardhost: Controller requests Cardhost connection
 * 6. connected: Router confirms session established
 * 7. rpc-request/response: Normal RPC flow
 */

import type { WebSocket } from "ws";
import { createLogger } from "@remote-apdu/shared";
import type { Router } from "../../router.js";

const logger = createLogger("router:controller-ws");

interface ConnectionState {
  phase: "authenticating" | "connecting" | "rpc";
  controllerId?: string;
  publicKey?: string;
  challenge?: string;
  sessionToken?: string;
  cardhostUuid?: string;
}

export async function handleControllerWebSocket(
  ws: WebSocket,
  router: Router,
): Promise<void> {
  const state: ConnectionState = { phase: "authenticating" };

  logger.info("Controller WebSocket connection established");

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (state.phase === "authenticating") {
        await handleAuthPhase(ws, msg, router, state);
      } else if (state.phase === "connecting") {
        await handleConnectPhase(ws, msg, router, state);
      } else if (state.phase === "rpc") {
        await handleRpcPhase(ws, msg, router, state);
      }
    } catch (error) {
      logger.error("Error handling message", error as Error);
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              code: "INTERNAL_ERROR",
              message: (error as Error).message,
            },
          })
        );
      } catch {}
    }
  });

  ws.on("close", () => {
    if (state.sessionToken) {
      router.transportUseCase.unregisterController(state.sessionToken);
    }
    logger.info("Controller WebSocket connection closed");
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", err);
  });
}

/**
 * 認証フェーズ処理
 */
async function handleAuthPhase(
  ws: WebSocket,
  msg: any,
  router: Router,
  state: ConnectionState
): Promise<void> {
  if (msg.type === "auth-init") {
    // Step 1: Receive public key
    const { publicKey } = msg;
    state.publicKey = publicKey;

    // Step 2: Generate Controller ID and challenge
    const { controllerId, challenge } =
      await router.controllerUseCase.initiateAuth(publicKey);

    state.controllerId = controllerId;
    state.challenge = challenge;

    // Send challenge
    ws.send(
      JSON.stringify({
        type: "auth-challenge",
        controllerId,
        challenge,
      })
    );
  } else if (msg.type === "auth-verify") {
    // Step 3: Verify signature
    if (!state.controllerId || !state.challenge) {
      throw new Error("Invalid auth sequence");
    }

    const { signature } = msg;
    const isValid = await router.controllerUseCase.verifyAuth(
      state.controllerId,
      state.challenge,
      signature
    );

    if (!isValid) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: {
            code: "AUTH_FAILED",
            message: "Signature verification failed",
          },
        })
      );
      ws.close(1008, "Authentication failed");
      return;
    }

    // Step 4: Authentication successful
    ws.send(
      JSON.stringify({
        type: "auth-success",
        controllerId: state.controllerId,
      })
    );

    state.phase = "connecting";
    logger.info("Controller authenticated", { controllerId: state.controllerId });
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        error: {
          code: "INVALID_PHASE",
          message: "Expected auth-init or auth-verify",
        },
      })
    );
  }
}

/**
 * 接続フェーズ処理
 */
async function handleConnectPhase(
  ws: WebSocket,
  msg: any,
  router: Router,
  state: ConnectionState
): Promise<void> {
  if (msg.type === "connect-cardhost") {
    const { cardhostUuid } = msg;

    if (!state.controllerId) {
      throw new Error("Not authenticated");
    }

    // Create session
    const session = router.controllerUseCase.createSession(
      state.controllerId,
      cardhostUuid
    );

    state.sessionToken = session.token;
    state.cardhostUuid = cardhostUuid;
    state.phase = "rpc";

    // Register controller transport
    router.transportUseCase.registerController(state.sessionToken, (data) => {
      try {
        ws.send(typeof data === "string" ? data : JSON.stringify(data));
      } catch {}
    });

    // Notify Cardhost that Controller has connected (遅延初期化トリガー)
    router.transportUseCase.notifyCardhostControllerConnected(cardhostUuid);

    // Send connected confirmation
    ws.send(
      JSON.stringify({
        type: "connected",
        cardhostUuid,
      })
    );

    logger.info("Controller connected to cardhost", {
      controllerId: state.controllerId,
      cardhostUuid,
    });
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        error: {
          code: "INVALID_PHASE",
          message: "Expected connect-cardhost",
        },
      })
    );
  }
}

/**
 * RPC フェーズ処理
 */
async function handleRpcPhase(
  ws: WebSocket,
  msg: any,
  router: Router,
  state: ConnectionState
): Promise<void> {
  if (msg.type === "rpc-request") {
    if (!state.sessionToken) {
      throw new Error("No session token");
    }

    // Relay to cardhost
    const response = await router.transportUseCase.relayFromController(
      state.sessionToken,
      msg
    );

    // Send response back
    ws.send(JSON.stringify(response));
  } else if (msg.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
  } else {
    ws.send(
      JSON.stringify({
        type: "error",
        error: {
          code: "UNKNOWN_MESSAGE",
          message: `Unknown message type: ${msg.type}`,
        },
      })
    );
  }
}
