/**
 * Controller Library - Public API
 *
 * This is the library layer that can be imported and tested.
 * Runtime layer (CLI) uses these classes.
 */

export { ControllerClient } from "./controller-client.js";
export { SessionManager } from "./session-manager.js";
export { RouterClientTransport } from "./router-transport.js";
export { KeyManager } from "./key-manager.js";

export type { RouterClientTransportConfig } from "./router-transport.js";
export type { SessionManagerConfig } from "./session-manager.js";
export type { ControllerKeyPair, ControllerIdentity } from "./key-manager.js";

// Re-export useful types from shared
export type {
  CardhostInfo,
  SessionToken,
} from "@remote-apdu/shared";

// Note: ControllerConfig now defined in controller-client.ts (no longer uses bearer token)
export type { ControllerConfig } from "./controller-client.js";

// Re-export jsapdu-interface types for convenience
export { CommandApdu, ResponseApdu } from "@aokiapp/jsapdu-interface";
export type {
  SmartCardPlatform,
  SmartCardDevice,
  SmartCard,
} from "@aokiapp/jsapdu-interface";
