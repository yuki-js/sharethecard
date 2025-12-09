/**
 * Authentication Test Helpers
 * Shared authentication flow helpers for tests
 */

import type { Router } from "../../src/router.js";
import type { ControllerUseCase } from "../../src/usecase/controller-usecase.js";
import type { CardhostUseCase } from "../../src/usecase/cardhost-usecase.js";
import type { AuthService } from "../../src/service/auth-service.js";
import { generateEd25519KeyPair, signChallenge } from "./crypto.js";

/**
 * Authenticate a controller with generated keypair
 * Returns controller ID and keypair
 */
export async function authenticateController(
  useCase: ControllerUseCase,
): Promise<{
  controllerId: string;
  publicKey: string;
  privateKey: string;
}> {
  const { publicKey, privateKey } = await generateEd25519KeyPair();
  const { controllerId, challenge } = await useCase.initiateAuth(publicKey);
  const signature = await signChallenge(challenge, privateKey);
  await useCase.verifyAuth(controllerId, challenge, signature);

  return { controllerId, publicKey, privateKey };
}

/**
 * Authenticate a cardhost with generated keypair
 * Returns UUID and keypair
 */
export async function authenticateCardhost(
  useCase: CardhostUseCase,
): Promise<{
  uuid: string;
  publicKey: string;
  privateKey: string;
}> {
  const { publicKey, privateKey } = await generateEd25519KeyPair();
  const { uuid, challenge } = await useCase.initiateAuth(publicKey);
  const signature = await signChallenge(challenge, privateKey);
  await useCase.verifyAuth(uuid, challenge, signature);

  return { uuid, publicKey, privateKey };
}

/**
 * Authenticate cardhost via AuthService directly
 * (for use cases where CardhostUseCase is not available)
 */
export async function authenticateCardhostDirect(
  authService: AuthService,
): Promise<{
  uuid: string;
  publicKey: string;
  privateKey: string;
}> {
  const { publicKey, privateKey } = await generateEd25519KeyPair();
  const { uuid, challenge } = await authService.initiateCardhostAuth(publicKey);
  const signature = await signChallenge(challenge, privateKey);
  await authService.verifyCardhostAuth(uuid, challenge, signature);

  return { uuid, publicKey, privateKey };
}

/**
 * Complete full authentication flow including session creation
 */
export async function createAuthenticatedSession(
  router: Router,
): Promise<{
  controllerId: string;
  cardhostUuid: string;
  sessionToken: string;
}> {
  const { controllerId } = await authenticateController(
    router.controllerUseCase,
  );
  const { uuid: cardhostUuid } = await authenticateCardhost(
    router.cardhostUseCase,
  );

  const sessionToken = router.controllerUseCase.createSession(
    controllerId,
    cardhostUuid,
  );

  return {
    controllerId,
    cardhostUuid,
    sessionToken: sessionToken.token,
  };
}