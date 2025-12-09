/**
 * Cardhost Library - Public API
 * 
 * This is the library layer that can be imported and tested.
 * Runtime layer (main.ts) uses these classes.
 */

export { CardhostService } from './cardhost-service.js';
export { ConfigManager } from './config-manager.js';
export { AuthManager } from './auth-manager.js';
export { MockSmartCardPlatform } from './mock-platform.js';
export { RouterServerTransport } from './router-transport.js';

export type { CardhostServiceConfig } from './cardhost-service.js';
export type { CardHostPersistedConfig } from './config-manager.js';
export type { AuthenticationResult } from './auth-manager.js';
export type { RouterTransportConfig } from './router-transport.js';