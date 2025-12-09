/**
 * Cardhost REST Routes
 * HTTP endpoints for cardhost authentication
 * 
 * IMPORTANT: Cardhost UUID is derived from public key by router.
 * Cardhosts cannot choose their own UUID.
 */

import { Hono } from "hono";
import { CardhostUseCase } from "../../usecase/cardhost-usecase.js";

export function createCardhostRoutes(
  cardhostUseCase: CardhostUseCase,
): Hono {
  const app = new Hono();

  /**
   * POST /cardhost/connect
   * Initiate cardhost authentication
   * Request: { publicKey }
   * Response: { uuid, challenge }
   */
  app.post("/cardhost/connect", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { publicKey } = body as { publicKey?: string };

    if (!publicKey) {
      return c.json({ error: "publicKey required" }, 400);
    }

    try {
      const result = await cardhostUseCase.initiateAuth(publicKey);
      return c.json(result, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  /**
   * POST /cardhost/verify
   * Verify cardhost authentication
   * Request: { uuid, challenge, signature }
   * Response: { ok: true }
   */
  app.post("/cardhost/verify", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid request body" }, 400);
    }

    const { uuid, challenge, signature } = body as {
      uuid?: string;
      challenge?: string;
      signature?: string;
    };

    if (!uuid || !challenge || !signature) {
      return c.json({ error: "uuid, challenge, and signature required" }, 400);
    }

    try {
      const isValid = await cardhostUseCase.verifyAuth(uuid, challenge, signature);

      if (!isValid) {
        return c.json({ error: "Signature verification failed" }, 401);
      }

      return c.json({ ok: true }, 200);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  return app;
}