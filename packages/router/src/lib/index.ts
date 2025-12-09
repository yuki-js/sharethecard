/**
 * Router Library - Public API
 *
 * This is the library layer that can be imported and tested.
 * Runtime layer (server.ts) uses these classes.
 */

export { RouterService } from "./router-service.js";
export { ControllerAuth } from "./auth/controller-auth.js";
export { CardhostAuth } from "./auth/cardhost-auth.js";
export { SessionRelay } from "./relay/session-relay.js";

export type { ControllerSession } from "./auth/controller-auth.js";
export type { CardhostRegistry } from "./auth/cardhost-auth.js";
export type { RelaySession, ConnectionInfo } from "./relay/session-relay.js";

// Re-export useful types from shared
export type {
  RouterConfig,
  SessionToken,
  CardhostInfo,
} from "@remote-apdu/shared";
