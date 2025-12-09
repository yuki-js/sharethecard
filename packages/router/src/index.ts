/**
 * Router Package - Main Entry Point
 * Exports library API for programmatic use
 */

// Main router class
export { Router } from "./router.js";

// Server for standalone/testing use
export { startServer, type ServerConfig } from "./server.js";

// Use cases (for advanced usage)
export { ControllerUseCase } from "./usecase/controller-usecase.js";
export { CardhostUseCase } from "./usecase/cardhost-usecase.js";
export { TransportUseCase } from "./usecase/transport-usecase.js";

// Re-export useful types from shared
export type {
  RouterConfig,
  SessionToken,
  CardhostInfo,
} from "@remote-apdu/shared";