/**
 * Cardhost WebSocket Handler
 * Handles WebSocket connections from cardhosts with message-based authentication
 * 
 * Flow:
 * 1. auth-init: Cardhost sends public key
 * 2. auth-challenge: Router sends UUID + challenge
 * 3. auth-verify: Cardhost sends signature
 * 4. auth-success: Router confirms authentication
 * 5. rpc-request/response: Normal RPC flow
 */

import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { createLogger } from "@remote-apdu/shared";
import type { Router } from "../../router.js";

const logger = createLogger("router:cardhost-ws");

interface ConnectionState {
  phase: "authenticating" | "rpc";
  uuid?: string;
  publicKey?: string;
  challenge?: string;
}

export async function handleCardhostWebSocket(
  ws: WebSocket,
  req: IncomingMessage,
  router: Router,
): Promise<void> {
  const state: ConnectionState = { phase: "authenticating" };

  logger.info("Cardhost WebSocket connection established");

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (state.phase === "authenticating") {
        await handleAuthPhase(ws, msg, router, state);
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
    if (state.uuid) {
      router.transportUseCase.unregisterCardhost(state.uuid);
      router.cardhostUseCase.disconnect(state.uuid);
    }
    logger.info("Cardhost WebSocket connection closed");
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

    // Step 2: Generate UUID and challenge
    const { uuid, challenge } =
      await router.cardhostUseCase.initiateAuth(publicKey);

    state.uuid = uuid;
    state.challenge = challenge;

    // Send challenge
    ws.send(
      JSON.stringify({
        type: "auth-challenge",
        uuid,
        challenge,
      })
    );
  } else if (msg.type === "auth-verify") {
    // Step 3: Verify signature
    if (!state.uuid || !state.challenge) {
      throw new Error("Invalid auth sequence");
    }

    const { signature } = msg;
    const isValid = await router.cardhostUseCase.verifyAuth(
      state.uuid,
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
        uuid: state.uuid,
      })
    );

    // Register cardhost connection
    router.transportUseCase.registerCardhost(state.uuid, (data) => {
      try {
        ws.send(typeof data === "string" ? data : JSON.stringify(data));
      } catch {}
    });

    state.phase = "rpc";
    logger.info("Cardhost authenticated", { uuid: state.uuid });
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
 * RPC フェーズ処理
 */
async function handleRpcPhase(
  ws: WebSocket,
  msg: any,
  router: Router,
  state: ConnectionState
): Promise<void> {
  if (msg.type === "rpc-response") {
    // Handle RPC response from cardhost
    if (!state.uuid) {
      throw new Error("Not authenticated");
    }

    router.transportUseCase.handleCardhostData(state.uuid, msg);
  } else if (msg.type === "rpc-event") {
    // Handle event from cardhost
    if (!state.uuid) {
      throw new Error("Not authenticated");
    }

    router.transportUseCase.handleCardhostData(state.uuid, msg);
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
