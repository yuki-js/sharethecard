/**
 * Cardhost Use Case
 * Business logic for cardhost authentication and connection management
 */

import type { CardhostInfo } from "@remote-apdu/shared";
import { AuthService } from "../service/auth-service.js";
import { CardhostRepository } from "../repository/cardhost-repository.js";

export class CardhostUseCase {
  constructor(
    private authService: AuthService,
    private cardhostRepo: CardhostRepository,
  ) {}

  /**
   * Initiate cardhost authentication
   * Step 1: Derive UUID from public key, register, and issue challenge
   *
   * Returns both the derived UUID and the challenge.
   * The cardhost cannot choose their own UUID.
   */
  async initiateAuth(publicKey: string): Promise<{ uuid: string; challenge: string }> {
    return await this.authService.initiateCardhostAuth(publicKey);
  }

  /**
   * Verify cardhost authentication
   * Step 2: Verify signature
   */
  async verifyAuth(
    uuid: string,
    challenge: string,
    signature: string,
  ): Promise<boolean> {
    return await this.authService.verifyCardhostAuth(uuid, challenge, signature);
  }

  /**
   * Check if cardhost is connected
   */
  isConnected(uuid: string): boolean {
    return this.authService.isCardhostConnected(uuid);
  }

  /**
   * List all cardhosts
   */
  listCardhosts(): CardhostInfo[] {
    return this.cardhostRepo.listAll().map((ch) => ({
      uuid: ch.uuid,
      connected: ch.connected,
    }));
  }

  /**
   * Disconnect cardhost
   */
  disconnect(uuid: string): void {
    this.authService.disconnectCardhost(uuid);
  }
}