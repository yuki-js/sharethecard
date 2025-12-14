/**
 * Router - Main Application
 * Integrates all layers and provides the core router functionality
 * Can be used as a library or started as a standalone server
 */

import type { RouterConfig } from "./shared/types.js";

// Repository layer
import { SessionRepository } from "./repository/session-repository.js";
import { CardhostRepository } from "./repository/cardhost-repository.js";
import { ConnectionRepository } from "./repository/connection-repository.js";
import { ControllerRepository } from "./repository/controller-repository.js";

// Service layer
import { SessionService } from "./service/session-service.js";
import { AuthService } from "./service/auth-service.js";
import { ControllerAuthService } from "./service/controller-auth-service.js";
import { TransportService } from "./service/transport-service.js";

// Use case layer
import { ControllerUseCase } from "./usecase/controller-usecase.js";
import { CardhostUseCase } from "./usecase/cardhost-usecase.js";
import { TransportUseCase } from "./usecase/transport-usecase.js";

export class Router {
  // Repositories
  private sessionRepo: SessionRepository;
  private cardhostRepo: CardhostRepository;
  private controllerRepo: ControllerRepository;
  private connectionRepo: ConnectionRepository;

  // Services
  private sessionService: SessionService;
  private cardhostAuthService: AuthService;
  private controllerAuthService: ControllerAuthService;
  private transportService: TransportService;

  // Use cases
  public readonly controllerUseCase: ControllerUseCase;
  public readonly cardhostUseCase: CardhostUseCase;
  public readonly transportUseCase: TransportUseCase;

  private running = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private config: RouterConfig = {}) {
    // Initialize repositories
    this.sessionRepo = new SessionRepository();
    this.cardhostRepo = new CardhostRepository();
    this.controllerRepo = new ControllerRepository();
    this.connectionRepo = new ConnectionRepository();

    // Initialize services
    this.sessionService = new SessionService(this.sessionRepo);
    this.cardhostAuthService = new AuthService(this.cardhostRepo);
    this.controllerAuthService = new ControllerAuthService(this.controllerRepo);
    this.transportService = new TransportService(this.connectionRepo);

    // Initialize use cases
    this.controllerUseCase = new ControllerUseCase(
      this.controllerAuthService,
      this.sessionService,
      this.cardhostAuthService,
    );
    this.cardhostUseCase = new CardhostUseCase(
      this.cardhostAuthService,
      this.cardhostRepo,
    );
    this.transportUseCase = new TransportUseCase(
      this.transportService,
      this.sessionService,
    );
  }

  /**
   * Start router service
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Router already running");
    }

    // Start periodic cleanup tasks
    this.cleanupInterval = setInterval(() => {
      this.sessionService.cleanupExpired();
      this.sessionService.cleanupInactive(30 * 60 * 1000); // 30 minutes
      this.cardhostAuthService.cleanupExpiredChallenges();
      this.controllerAuthService.cleanupExpiredChallenges();
    }, 60 * 1000); // Every minute

    this.running = true;
  }

  /**
   * Stop router service
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.transportService.shutdown();
    this.running = false;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get service statistics
   */
  getStats(): {
    running: boolean;
    activeControllers: number;
    activeCardhosts: number;
    activeSessions: number;
    connectedCardhosts: number;
  } {
    const connections = this.transportUseCase.getConnectionCounts();

    return {
      running: this.running,
      activeControllers: this.sessionService.getActiveCount(),
      activeCardhosts: connections.cardhosts,
      activeSessions: this.sessionService.getActiveCount(),
      connectedCardhosts: this.cardhostRepo.countConnected(),
    };
  }
}