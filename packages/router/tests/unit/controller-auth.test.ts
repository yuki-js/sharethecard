/**
 * Unit tests for Controller Authentication
 *
 * Tests public key authentication and session management
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, beforeEach } from "vitest";

import { CardhostRepository } from "../../src/repository/cardhost-repository.js";
import { ControllerRepository } from "../../src/repository/controller-repository.js";
import { SessionRepository } from "../../src/repository/session-repository.js";
import { AuthService } from "../../src/service/auth-service.js";
import { ControllerAuthService } from "../../src/service/controller-auth-service.js";
import { SessionService } from "../../src/service/session-service.js";
import { ControllerUseCase } from "../../src/usecase/controller-usecase.js";
import { authenticateCardhostDirect } from "../helpers/auth-helpers.js";
import { generateEd25519KeyPair, signChallenge } from "../helpers/crypto.js";

describe("Controller Authentication", () => {
  let auth: ControllerUseCase;
  let sessionService: SessionService;
  let controllerAuthService: ControllerAuthService;
  let cardhostAuthService: AuthService;

  beforeEach(() => {
    const sessionRepo = new SessionRepository();
    const cardhostRepo = new CardhostRepository();
    const controllerRepo = new ControllerRepository();
    sessionService = new SessionService(sessionRepo);
    controllerAuthService = new ControllerAuthService(controllerRepo);
    cardhostAuthService = new AuthService(cardhostRepo);
    auth = new ControllerUseCase(
      controllerAuthService,
      sessionService,
      cardhostAuthService,
    );
  });

  describe("Public Key Authentication", () => {
    it("should complete challenge-response authentication", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);

      expect(controllerId).toBeDefined();
      expect(controllerId).toMatch(/^peer_/);
      expect(challenge).toBeDefined();
      expect(challenge.length).toBeGreaterThan(0);

      const signature = await signChallenge(challenge, privateKey);
      const isAuthenticated = await auth.verifyAuth(
        controllerId,
        challenge,
        signature,
      );

      expect(isAuthenticated).toBe(true);
      expect(auth.isAuthenticated(controllerId)).toBe(true);
    });

    it("should generate consistent controller ID from same public key", async () => {
      const { publicKey } = await generateEd25519KeyPair();

      const result1 = await auth.initiateAuth(publicKey);
      const result2 = await auth.initiateAuth(publicKey);

      expect(result1.controllerId).toBe(result2.controllerId);
    });

    it("should generate different IDs for different public keys", async () => {
      const { publicKey: pubKey1 } = await generateEd25519KeyPair();
      const { publicKey: pubKey2 } = await generateEd25519KeyPair();

      const result1 = await auth.initiateAuth(pubKey1);
      const result2 = await auth.initiateAuth(pubKey2);

      expect(result1.controllerId).not.toBe(result2.controllerId);
    });

    it("should reject invalid signature", async () => {
      const { publicKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);

      const invalidSignature = Buffer.from(new Uint8Array(64)).toString(
        "base64",
      );

      const isAuthenticated = await auth.verifyAuth(
        controllerId,
        challenge,
        invalidSignature,
      );

      expect(isAuthenticated).toBe(false);
      expect(auth.isAuthenticated(controllerId)).toBe(false);
    });

    it("should reject mismatched challenge", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId } = await auth.initiateAuth(publicKey);
      const challenge2 = "different-challenge";
      const signature = await signChallenge(challenge2, privateKey);

      await expect(
        auth.verifyAuth(controllerId, challenge2, signature),
      ).rejects.toThrow("Challenge");
    });
  });

  describe("Session Creation", () => {
    it("should create session after authentication", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      const { uuid: cardhostUuid } = await authenticateCardhostDirect(
        cardhostAuthService,
      );

      const sessionToken = auth.createSession(controllerId, cardhostUuid);

      expect(sessionToken).toHaveProperty("token");
      expect(sessionToken).toHaveProperty("expiresAt");
      expect(sessionToken.token).toMatch(/^sess_/);
    });

    it("should reject session creation without authentication", async () => {
      const { publicKey } = await generateEd25519KeyPair();
      const { controllerId } = await auth.initiateAuth(publicKey);
      const cardhostUuid = "cardhost-002";

      expect(() => {
        auth.createSession(controllerId, cardhostUuid);
      }).toThrow("not authenticated");
    });

    it("should reject session creation for disconnected cardhost", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      expect(() => {
        auth.createSession(controllerId, "non-existent-cardhost");
      }).toThrow("not connected");
    });
  });

  describe("Session Validation", () => {
    it("should validate valid session token", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      const { uuid: cardhostUuid } = await authenticateCardhostDirect(
        cardhostAuthService,
      );

      const sessionToken = auth.createSession(controllerId, cardhostUuid);

      const isValid = auth.validateSession(sessionToken.token);
      expect(isValid).toBe(true);
    });

    it("should return false for non-existent session", () => {
      const isValid = auth.validateSession("non-existent-session");
      expect(isValid).toBe(false);
    });

    it("should get cardhost for session", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      const { uuid: cardhostUuid } = await authenticateCardhostDirect(
        cardhostAuthService,
      );

      const sessionToken = auth.createSession(controllerId, cardhostUuid);

      const cardhost = auth.getCardhostForSession(sessionToken.token);
      expect(cardhost).toBe(cardhostUuid);
    });

    it("should get controller for session", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      const { uuid: cardhostUuid } = await authenticateCardhostDirect(
        cardhostAuthService,
      );

      const sessionToken = auth.createSession(controllerId, cardhostUuid);

      const controller = auth.getControllerForSession(sessionToken.token);
      expect(controller).toBe(controllerId);
    });
  });

  describe("Session Revocation", () => {
    it("should revoke session", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      const { uuid: cardhostUuid } = await authenticateCardhostDirect(
        cardhostAuthService,
      );

      const sessionToken = auth.createSession(controllerId, cardhostUuid);

      auth.revokeSession(sessionToken.token);

      const isValid = auth.validateSession(sessionToken.token);
      expect(isValid).toBe(false);
    });

    it("should not throw error when revoking non-existent session", () => {
      expect(() => {
        auth.revokeSession("non-existent");
      }).not.toThrow();
    });
  });

  describe("Disconnect", () => {
    it("should disconnect controller", async () => {
      const { publicKey, privateKey } = await generateEd25519KeyPair();

      const { controllerId, challenge } = await auth.initiateAuth(publicKey);
      const signature = await signChallenge(challenge, privateKey);
      await auth.verifyAuth(controllerId, challenge, signature);

      expect(auth.isAuthenticated(controllerId)).toBe(true);

      auth.disconnect(controllerId);

      expect(auth.isAuthenticated(controllerId)).toBe(false);
    });
  });
});