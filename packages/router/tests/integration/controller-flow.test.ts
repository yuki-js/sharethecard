/**
 * Integration tests for Controller flow at presentation layer
 * 
 * Tests the full sequence through presentation layer (REST + WebSocket)
 * without starting an actual HTTP server.
 * 
 * Spec: docs/what-to-make.md Section 6.2.2 - 結合テスト
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Router } from "../../src/router.js";
import { createControllerRoutes } from "../../src/presentation/rest/controller-routes.js";
import { createCardhostRoutes } from "../../src/presentation/rest/cardhost-routes.js";
import { handleControllerWebSocket } from "../../src/presentation/ws/controller-ws.js";
import { handleCardhostWebSocket } from "../../src/presentation/ws/cardhost-ws.js";
import { generateEd25519KeyPair, signChallenge } from "../helpers/crypto.js";
import { authenticateController, authenticateCardhost, createAuthenticatedSession } from "../helpers/auth-helpers.js";
import { MockWebSocket } from "../helpers/mock-websocket.js";

describe("Controller Flow Integration", () => {
  let router: Router;
  let controllerApp: ReturnType<typeof createControllerRoutes>;
  let cardhostApp: ReturnType<typeof createCardhostRoutes>;

  beforeEach(async () => {
    router = new Router();
    await router.start();
    controllerApp = createControllerRoutes(
      router.controllerUseCase,
      router.cardhostUseCase,
    );
    cardhostApp = createCardhostRoutes(router.cardhostUseCase);
  });

  afterEach(async () => {
    await router.stop();
  });

  describe("Complete Authentication Sequence", () => {
    it("should complete full controller authentication flow via REST API", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      // Step 1: Initiate (router derives ID)
      const initiateReq = new Request(
        "http://localhost/controller/auth/initiate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey }),
        },
      );

      const initiateRes = await controllerApp.fetch(initiateReq);
      expect(initiateRes.status).toBe(201);

      const { controllerId, challenge } = await initiateRes.json();
      expect(controllerId).toMatch(/^peer_/);
      expect(challenge).toBeDefined();

      // Step 2: Verify
      const signature = await signChallenge(challenge, privateKey);

      const verifyReq = new Request(
        "http://localhost/controller/auth/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ controllerId, challenge, signature }),
        },
      );

      const verifyRes = await controllerApp.fetch(verifyReq);
      expect(verifyRes.status).toBe(200);

      const verifyData = await verifyRes.json();
      expect(verifyData.ok).toBe(true);
      expect(verifyData.controllerId).toBe(controllerId);
    });

    it("should reject controller authentication with invalid signature", async () => {
      const { publicKey } = await generateEd25519KeyPair();

      const initiateReq = new Request(
        "http://localhost/controller/auth/initiate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey }),
        },
      );

      const initiateRes = await controllerApp.fetch(initiateReq);
      const { controllerId, challenge } = await initiateRes.json();

      const invalidSignature = Buffer.from(new Uint8Array(64)).toString(
        "base64",
      );

      const verifyReq = new Request(
        "http://localhost/controller/auth/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            controllerId,
            challenge,
            signature: invalidSignature,
          }),
        },
      );

      const verifyRes = await controllerApp.fetch(verifyReq);
      expect(verifyRes.status).toBe(401);

      const verifyData = await verifyRes.json();
      expect(verifyData.error).toContain("verification failed");
    });
  });

  describe("Session Creation Sequence", () => {
    it("should create session after successful authentication", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );
      const { uuid: cardhostUuid } = await authenticateCardhost(
        router.cardhostUseCase,
      );

      const sessionReq = new Request("http://localhost/controller/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controllerId, cardhostUuid }),
      });

      const sessionRes = await controllerApp.fetch(sessionReq);
      expect(sessionRes.status).toBe(201);

      const sessionData = await sessionRes.json();
      expect(sessionData.token).toMatch(/^sess_/);
      expect(sessionData.expiresAt).toBeDefined();
    });

    it("should reject session creation for unauthenticated controller", async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const { controllerId } = await router.controllerUseCase.initiateAuth(
        publicKey,
      );
      const cardhostUuid = "ch-any";

      const sessionReq = new Request("http://localhost/controller/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controllerId, cardhostUuid }),
      });

      const sessionRes = await controllerApp.fetch(sessionReq);
      expect(sessionRes.status).toBe(401);

      const data = await sessionRes.json();
      expect(data.error).toContain("not authenticated");
    });

    it("should reject session creation for disconnected cardhost", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );

      const sessionReq = new Request("http://localhost/controller/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          controllerId,
          cardhostUuid: "non-existent",
        }),
      });

      const sessionRes = await controllerApp.fetch(sessionReq);
      expect(sessionRes.status).toBe(404);

      const data = await sessionRes.json();
      expect(data.error).toContain("not connected");
    });
  });

  describe("Cardhost Listing Sequence", () => {
    it("should list cardhosts for authenticated controller", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );
      const { uuid: ch1Uuid } = await authenticateCardhost(
        router.cardhostUseCase,
      );

      const listReq = new Request("http://localhost/controller/cardhosts", {
        method: "GET",
        headers: { "x-controller-id": controllerId },
      });

      const listRes = await controllerApp.fetch(listReq);
      expect(listRes.status).toBe(200);

      const cardhosts = await listRes.json();
      expect(Array.isArray(cardhosts)).toBe(true);
      expect(cardhosts.length).toBeGreaterThan(0);
      expect(cardhosts.some((c: any) => c.uuid === ch1Uuid)).toBe(true);
    });

    it("should reject cardhost listing for unauthenticated controller", async () => {
      const listReq = new Request("http://localhost/controller/cardhosts", {
        method: "GET",
        headers: { "x-controller-id": "unauthenticated" },
      });

      const listRes = await controllerApp.fetch(listReq);
      expect(listRes.status).toBe(401);

      const data = await listRes.json();
      expect(data.error).toContain("not authenticated");
    });
  });

  describe("WebSocket Connection Sequence", () => {
    it("should establish controller WebSocket connection after authentication", async () => {
      const { controllerId, cardhostUuid, sessionToken } =
        await createAuthenticatedSession(router);

      const controllerWs = new MockWebSocket();
      const cardhostWs = new MockWebSocket();

      handleControllerWebSocket(
        controllerWs as any,
        controllerId,
        sessionToken,
        router.controllerUseCase,
        router.transportUseCase,
      );

      handleCardhostWebSocket(
        cardhostWs as any,
        cardhostUuid,
        router.cardhostUseCase,
        router.transportUseCase,
      );

      expect(controllerWs.closed).toBe(false);
      expect(cardhostWs.closed).toBe(false);

      controllerWs.close();
      cardhostWs.close();
    });

    it("should reject WebSocket for unauthenticated controller", () => {
      const ws = new MockWebSocket();

      handleControllerWebSocket(
        ws as any,
        "unauthenticated-ctrl",
        "fake-session",
        router.controllerUseCase,
        router.transportUseCase,
      );

      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(1008);
      expect(ws.closeReason).toContain("not authenticated");
    });

    it("should reject WebSocket for invalid session token", async () => {
      const { controllerId } = await authenticateController(
        router.controllerUseCase,
      );

      const ws = new MockWebSocket();

      handleControllerWebSocket(
        ws as any,
        controllerId,
        "invalid-session",
        router.controllerUseCase,
        router.transportUseCase,
      );

      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(1008);
      expect(ws.closeReason).toContain("Invalid session");
    });

    it("should reject WebSocket when session belongs to different controller", async () => {
      const { controllerId: controllerId1 } = await authenticateController(
        router.controllerUseCase,
      );
      const { uuid: cardhostUuid } = await authenticateCardhost(
        router.cardhostUseCase,
      );

      const session1 = router.controllerUseCase.createSession(
        controllerId1,
        cardhostUuid,
      );

      const { controllerId: controllerId2 } = await authenticateController(
        router.controllerUseCase,
      );

      const ws = new MockWebSocket();

      handleControllerWebSocket(
        ws as any,
        controllerId2,
        session1.token,
        router.controllerUseCase,
        router.transportUseCase,
      );

      expect(ws.closed).toBe(true);
      expect(ws.closeCode).toBe(1008);
      expect(ws.closeReason).toContain("does not belong");
    });
  });

  describe("Cardhost Authentication Sequence", () => {
    it("should complete full cardhost authentication flow via REST API", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      // Step 1: Initiate (router derives UUID)
      const initiateReq = new Request("http://localhost/cardhost/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey }),
      });

      const initiateRes = await cardhostApp.fetch(initiateReq);
      expect(initiateRes.status).toBe(201);

      const { uuid, challenge } = await initiateRes.json();
      expect(uuid).toMatch(/^peer_/);
      expect(challenge).toBeDefined();

      // Step 2: Verify
      const signature = await signChallenge(challenge, privateKey);

      const verifyReq = new Request("http://localhost/cardhost/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uuid, challenge, signature }),
      });

      const verifyRes = await cardhostApp.fetch(verifyReq);
      expect(verifyRes.status).toBe(200);

      const verifyData = await verifyRes.json();
      expect(verifyData.ok).toBe(true);
    });

    it("should establish cardhost WebSocket connection after authentication", async () => {
      const { uuid } = await authenticateCardhost(router.cardhostUseCase);

      const ws = new MockWebSocket();

      handleCardhostWebSocket(
        ws as any,
        uuid,
        router.cardhostUseCase,
        router.transportUseCase,
      );

      expect(ws.closed).toBe(false);
      ws.close();
    });
  });

  describe("Full End-to-End Sequence", () => {
    it("should complete authentication → session creation → WebSocket connection sequence", async () => {
      // 1. Authenticate controller via REST
      const { publicKey: ctrlPubKey, privateKey: ctrlPrivKey } =
        await generateEd25519KeyPair();

      const ctrlInitReq = new Request(
        "http://localhost/controller/auth/initiate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ publicKey: ctrlPubKey }),
        },
      );

      const ctrlInitRes = await controllerApp.fetch(ctrlInitReq);
      const { controllerId, challenge: ctrlChallenge } =
        await ctrlInitRes.json();
      const ctrlSignature = await signChallenge(ctrlChallenge, ctrlPrivKey);

      const ctrlVerifyReq = new Request(
        "http://localhost/controller/auth/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            controllerId,
            challenge: ctrlChallenge,
            signature: ctrlSignature,
          }),
        },
      );

      const ctrlVerifyRes = await controllerApp.fetch(ctrlVerifyReq);
      expect(ctrlVerifyRes.status).toBe(200);

      // 2. Authenticate cardhost via REST
      const { publicKey: chPubKey, privateKey: chPrivKey } =
        await generateEd25519KeyPair();

      const chInitReq = new Request("http://localhost/cardhost/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey: chPubKey }),
      });

      const chInitRes = await cardhostApp.fetch(chInitReq);
      const { uuid: cardhostUuid, challenge: chChallenge } =
        await chInitRes.json();
      const chSignature = await signChallenge(chChallenge, chPrivKey);

      const chVerifyReq = new Request("http://localhost/cardhost/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uuid: cardhostUuid,
          challenge: chChallenge,
          signature: chSignature,
        }),
      });

      const chVerifyRes = await cardhostApp.fetch(chVerifyReq);
      expect(chVerifyRes.status).toBe(200);

      // 3. Create session via REST
      const sessionReq = new Request("http://localhost/controller/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controllerId, cardhostUuid }),
      });

      const sessionRes = await controllerApp.fetch(sessionReq);
      expect(sessionRes.status).toBe(201);

      const { token: sessionToken } = await sessionRes.json();
      expect(sessionToken).toBeDefined();

      // 4. Establish WebSocket connections
      const controllerWs = new MockWebSocket();
      const cardhostWs = new MockWebSocket();

      handleControllerWebSocket(
        controllerWs as any,
        controllerId,
        sessionToken,
        router.controllerUseCase,
        router.transportUseCase,
      );

      handleCardhostWebSocket(
        cardhostWs as any,
        cardhostUuid,
        router.cardhostUseCase,
        router.transportUseCase,
      );

      // 5. Verify both connections are established
      expect(controllerWs.closed).toBe(false);
      expect(cardhostWs.closed).toBe(false);

      controllerWs.close();
      cardhostWs.close();
    });
  });

  describe("Error Handling in Sequence", () => {
    it("should fail gracefully when steps are performed out of order", async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const { controllerId } = await router.controllerUseCase.initiateAuth(
        publicKey,
      );
      const cardhostUuid = "ch-any";

      const sessionReq = new Request("http://localhost/controller/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ controllerId, cardhostUuid }),
      });

      const sessionRes = await controllerApp.fetch(sessionReq);
      expect(sessionRes.status).toBe(401);
    });

    it("should validate all prerequisites before allowing WebSocket", async () => {
      const ws = new MockWebSocket();

      handleControllerWebSocket(
        ws as any,
        "no-auth",
        "no-session",
        router.controllerUseCase,
        router.transportUseCase,
      );

      expect(ws.closed).toBe(true);
    });
  });
});