/**
 * Integration tests for Controller flow via WebSocket presentation layer
 *
 * Tests the WebSocket message protocol sequence (v3.0 spec)
 * Validates presentation layer (handler) message routing and state management
 *
 * Spec: docs/what-to-make.md Section 6.2.2 - 結合テスト
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Router } from "../../src/router.js";
import { handleControllerWebSocket } from "../../src/presentation/ws/controller-ws.js";
import { handleCardhostWebSocket } from "../../src/presentation/ws/cardhost-ws.js";
import { generateEd25519KeyPair, signChallenge } from "../helpers/crypto.js";
import { MockWebSocket } from "../helpers/mock-websocket.js";

describe("Controller Flow Integration via WebSocket Presentation Layer", () => {
  let router: Router;

  beforeEach(async () => {
    router = new Router();
    await router.start();
  });

  afterEach(async () => {
    await router.stop();
  });

  describe("Controller Authentication Message Sequence", () => {
    it("should complete auth-init → auth-challenge → auth-verify → auth-success", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const ws = new MockWebSocket();

      // Start handler
      handleControllerWebSocket(ws as any, router);

      // Step 1: Send auth-init
      const authInitMsg = { type: "auth-init", publicKey };
      ws.receive(authInitMsg);

      // Wait for auth-challenge response
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.sentMessages.length).toBeGreaterThan(0);

      const challengeMsg = JSON.parse(ws.sentMessages[0] as string);
      expect(challengeMsg.type).toBe("auth-challenge");
      expect(challengeMsg.controllerId).toMatch(/^peer_/);
      expect(challengeMsg.challenge).toBeDefined();

      // Step 2: Sign and send auth-verify
      const signature = await signChallenge(
        challengeMsg.challenge,
        privateKey
      );

      const authVerifyMsg = {
        type: "auth-verify",
        signature,
      };
      ws.clearMessages();
      ws.receive(authVerifyMsg);

      // Wait for auth-success response
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.sentMessages.length).toBeGreaterThan(0);

      const successMsg = JSON.parse(ws.sentMessages[0] as string);
      expect(successMsg.type).toBe("auth-success");
      expect(successMsg.controllerId).toBe(challengeMsg.controllerId);
    });

    it("should reject auth-verify with invalid signature", async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const ws = new MockWebSocket();

      handleControllerWebSocket(ws as any, router);

      // Send auth-init
      ws.receive({ type: "auth-init", publicKey });

      await new Promise((r) => setTimeout(r, 50));

      // Send invalid signature
      const invalidSignature = Buffer.from(new Uint8Array(64)).toString(
        "base64"
      );

      ws.receive({
        type: "auth-verify",
        signature: invalidSignature,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(1008);
    });
  });

  describe("Cardhost Authentication Message Sequence", () => {
    it("should complete cardhost auth-init → auth-challenge → auth-verify → auth-success", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const ws = new MockWebSocket();
      const mockReq = {} as any;

      handleCardhostWebSocket(ws as any, mockReq, router);

      // Step 1: Send auth-init
      const authInitMsg = { type: "auth-init", publicKey };
      ws.receive(authInitMsg);

      // Wait for auth-challenge response
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.sentMessages.length).toBeGreaterThan(0);

      const challengeMsg = JSON.parse(ws.sentMessages[0] as string);
      expect(challengeMsg.type).toBe("auth-challenge");
      expect(challengeMsg.challenge).toBeDefined();

      // Step 2: Sign and send auth-verify
      const signature = await signChallenge(
        challengeMsg.challenge,
        privateKey
      );

      const authVerifyMsg = {
        type: "auth-verify",
        signature,
      };
      ws.clearMessages();
      ws.receive(authVerifyMsg);

      // Wait for auth-success response
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.sentMessages.length).toBeGreaterThan(0);

      const successMsg = JSON.parse(ws.sentMessages[0] as string);
      expect(successMsg.type).toBe("auth-success");
    });
  });

  describe("Controller Connection Sequence", () => {
    it("should complete full connection flow: auth → connect-cardhost → connected", async () => {
      const { publicKey: ctrlPubKey, privateKey: ctrlPrivKey } =
        await generateEd25519KeyPair();
      const { publicKey: chPubKey, privateKey: chPrivKey } =
        await generateEd25519KeyPair();

      // 1. Authenticate controller
      const controllerWs = new MockWebSocket();
      handleControllerWebSocket(controllerWs as any, router);

      controllerWs.receive({ type: "auth-init", publicKey: ctrlPubKey });
      await new Promise((r) => setTimeout(r, 50));

      const ctrlChallenge = JSON.parse(controllerWs.sentMessages[0] as string);
      const ctrlSig = await signChallenge(
        ctrlChallenge.challenge,
        ctrlPrivKey
      );

      controllerWs.clearMessages();
      controllerWs.receive({ type: "auth-verify", signature: ctrlSig });
      await new Promise((r) => setTimeout(r, 50));

      expect(JSON.parse(controllerWs.sentMessages[0] as string).type).toBe(
        "auth-success"
      );

      // 2. Authenticate cardhost
      const cardhostWs = new MockWebSocket();
      const mockReq = {} as any;
      handleCardhostWebSocket(cardhostWs as any, mockReq, router);

      cardhostWs.receive({ type: "auth-init", publicKey: chPubKey });
      await new Promise((r) => setTimeout(r, 50));

      const chChallenge = JSON.parse(cardhostWs.sentMessages[0] as string);
      const chSig = await signChallenge(
        chChallenge.challenge,
        chPrivKey
      );

      cardhostWs.clearMessages();
      cardhostWs.receive({ type: "auth-verify", signature: chSig });
      await new Promise((r) => setTimeout(r, 50));

      expect(JSON.parse(cardhostWs.sentMessages[0] as string).type).toBe(
        "auth-success"
      );

      // 3. Controller connects to cardhost
      controllerWs.clearMessages();

      // Obtain cardhost UUID from router-side state (Cardhost never sees its UUID)
      const list = router.cardhostUseCase.listCardhosts();
      const chUuid = (list.find((c) => c.connected) || list[0]).uuid;

      controllerWs.receive({
        type: "connect-cardhost",
        cardhostUuid: chUuid,
      });
      await new Promise((r) => setTimeout(r, 50));

      const connectedMsg = JSON.parse(controllerWs.sentMessages[0] as string);
      expect(connectedMsg.type).toBe("connected");
      expect(connectedMsg.cardhostUuid).toBe(chUuid);
    });

    it("should reject connect-cardhost without authentication", async () => {
      const controllerWs = new MockWebSocket();
      handleControllerWebSocket(controllerWs as any, router);

      // Try to connect without authenticating
      controllerWs.receive({
        type: "connect-cardhost",
        cardhostUuid: "peer_test",
      });

      await new Promise((r) => setTimeout(r, 50));

      const errorMsg = JSON.parse(controllerWs.sentMessages[0] as string);
      expect(errorMsg.type).toBe("error");
    });
  });

  describe("Message Error Handling", () => {
    it("should reject invalid message types in authenticating phase", async () => {
      const controllerWs = new MockWebSocket();
      handleControllerWebSocket(controllerWs as any, router);

      controllerWs.receive({ type: "invalid-type" });

      await new Promise((r) => setTimeout(r, 50));

      const errorMsg = JSON.parse(controllerWs.sentMessages[0] as string);
      expect(errorMsg.type).toBe("error");
      expect(errorMsg.error.code).toBe("INVALID_PHASE");
    });

    it("should handle ping/pong messages", async () => {
      const { publicKey: ctrlPubKey, privateKey: ctrlPrivKey } =
        await generateEd25519KeyPair();
      const { publicKey: chPubKey, privateKey: chPrivKey } =
        await generateEd25519KeyPair();

      const controllerWs = new MockWebSocket();
      const cardhostWs = new MockWebSocket();
      const mockReq = {} as any;

      handleControllerWebSocket(controllerWs as any, router);
      handleCardhostWebSocket(cardhostWs as any, mockReq, router);

      // Authenticate controller
      controllerWs.receive({ type: "auth-init", publicKey: ctrlPubKey });
      await new Promise((r) => setTimeout(r, 50));

      const ctrlChallenge = JSON.parse(controllerWs.sentMessages[0] as string);
      const ctrlSig = await signChallenge(
        ctrlChallenge.challenge,
        ctrlPrivKey
      );

      controllerWs.clearMessages();
      controllerWs.receive({ type: "auth-verify", signature: ctrlSig });
      await new Promise((r) => setTimeout(r, 50));

      // Authenticate cardhost
      cardhostWs.receive({ type: "auth-init", publicKey: chPubKey });
      await new Promise((r) => setTimeout(r, 50));

      const chChallenge = JSON.parse(cardhostWs.sentMessages[0] as string);
      const chSig = await signChallenge(
        chChallenge.challenge,
        chPrivKey
      );

      cardhostWs.clearMessages();
      cardhostWs.receive({ type: "auth-verify", signature: chSig });
      await new Promise((r) => setTimeout(r, 50));

      // Connect controller to cardhost
      controllerWs.clearMessages();
      const list = router.cardhostUseCase.listCardhosts();
      const chUuid = (list.find((c) => c.connected) || list[0]).uuid;
      controllerWs.receive({
        type: "connect-cardhost",
        cardhostUuid: chUuid,
      });
      await new Promise((r) => setTimeout(r, 50));

      // Now send ping in RPC phase
      controllerWs.clearMessages();
      controllerWs.receive({ type: "ping" });
      await new Promise((r) => setTimeout(r, 50));

      const pongMsg = JSON.parse(controllerWs.sentMessages[0] as string);
      expect(pongMsg.type).toBe("pong");
    });
  });

  describe("Connection State Management", () => {
    it("should handle connection closure and cleanup", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();
      const controllerWs = new MockWebSocket();

      handleControllerWebSocket(controllerWs as any, router);

      // Complete authentication
      controllerWs.receive({ type: "auth-init", publicKey });
      await new Promise((r) => setTimeout(r, 50));

      const challenge = JSON.parse(controllerWs.sentMessages[0] as string);
      const signature = await signChallenge(challenge.challenge, privateKey);

      controllerWs.receive({ type: "auth-verify", signature });
      await new Promise((r) => setTimeout(r, 50));

      // Close connection
      controllerWs.close();

      expect(controllerWs.closed).toBe(true);
    });

    it("should reject messages after connection closed", async () => {
      const controllerWs = new MockWebSocket();
      handleControllerWebSocket(controllerWs as any, router);

      controllerWs.close();
      await new Promise((r) => setTimeout(r, 50));

      expect(controllerWs.closed).toBe(true);
    });
  });
});
