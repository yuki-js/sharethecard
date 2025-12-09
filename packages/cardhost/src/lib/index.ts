/**
 * Cardhost Library - Public API
 *
 * This is the library layer that can be imported and tested.
 * Runtime layer (main.ts) uses these classes.
 */

export { CardhostService } from "./cardhost-service.js";
export { ConfigManager } from "./config-manager.js";
export { MockSmartCardPlatform } from "./mock-platform.js";
export { RouterServerTransport, WsAuthenticator } from "./router-transport.js";

export type { CardhostServiceConfig } from "./cardhost-service.js";
export type { CardHostPersistedConfig } from "./config-manager.js";
export type { RouterTransportConfig, WsAuthenticatorConfig } from "./router-transport.js";
