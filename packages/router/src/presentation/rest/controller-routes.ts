/**
 * Controller REST Routes
 * HTTP endpoints for controller authentication and session management
 * 
 * New authentication flow using public key cryptography:
 * 1. POST /controller/auth/initiate - Send public key, get controller ID & challenge
 * 2. POST /controller/auth/verify - Verify signature
 * 3. POST /controller/sessions - Create session for cardhost connection
 * 
 * IMPORTANT: Controller ID is derived from public key by router.
 * Controllers cannot choose their own ID.
 */

import { Hono } from "hono";
import { ControllerUseCase } from "../../usecase/controller-usecase.js";
import { CardhostUseCase } from "../../usecase/cardhost-usecase.js";

export function createControllerRoutes(
  controllerUseCase: ControllerUseCase,
  cardhostUseCase: CardhostUseCase,
): Hono {
  const app = new Hono();

  /**
   * POST /controller/auth/initiate
   * Initiate controller authentication
   * Request: { publicKey }
   * Response: { controllerId, challenge }
   */
  app.post("/controller/auth/initiate", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { publicKey } = body as { publicKey?: string };

    if (!publicKey) {
      return c.json({ error: "publicKey required" }, 400);
    }

    try {
      const result = await controllerUseCase.initiateAuth(publicKey);
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  /**
   * POST /controller/auth/verify
   * Verify controller authentication
   * Request: { controllerId, challenge, signature }
   * Response: { ok: true, controllerId }
   */
  app.post("/controller/auth/verify", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { controllerId, challenge, signature } = body as {
      controllerId?: string;
      challenge?: string;
      signature?: string;
    };

    if (!controllerId || !challenge || !signature) {
      return c.json(
        { error: "controllerId, challenge, and signature required" },
        400,
      );
    }

    try {
      const isValid = await controllerUseCase.verifyAuth(
        controllerId,
        challenge,
        signature,
      );

      if (!isValid) {
        return c.json({ error: "Signature verification failed" }, 401);
      }

      return c.json({ ok: true, controllerId }, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  /**
   * POST /controller/sessions
   * Create session for cardhost connection (after authentication)
   * Request: { controllerId, cardhostUuid }
   * Response: { token, expiresAt }
   */
  app.post("/controller/sessions", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { controllerId, cardhostUuid } = body as {
      controllerId?: string;
      cardhostUuid?: string;
    };

    if (!controllerId || !cardhostUuid) {
      return c.json({ error: "controllerId and cardhostUuid required" }, 400);
    }

    // Check if controller is authenticated
    if (!controllerUseCase.isAuthenticated(controllerId)) {
      return c.json({ error: "Controller not authenticated" }, 401);
    }

    try {
      const sessionToken = controllerUseCase.createSession(
        controllerId,
        cardhostUuid,
      );
      return c.json(sessionToken, 201);
    } catch (error) {
      const message = (error as Error).message;

      if (message.includes("not connected")) {
        return c.json({ error: message }, 404);
      }

      return c.json({ error: message }, 400);
    }
  });

  /**
   * GET /controller/cardhosts
   * List available cardhosts
   */
  app.get("/controller/cardhosts", (c) => {
    const controllerId = c.req.header("x-controller-id") ?? "";

    if (!controllerUseCase.isAuthenticated(controllerId)) {
      return c.json({ error: "Controller not authenticated" }, 401);
    }

    const cardhosts = cardhostUseCase.listCardhosts();
    return c.json(cardhosts);
  });

  return app;
}