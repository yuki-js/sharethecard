/**
 * Shared type definitions for Remote APDU System
 */

/**
 * Authentication types
 */
export interface SessionToken {
  token: string;
  expiresAt: string;
}

export interface CardhostInfo {
  uuid: string;
  connected: boolean;
}

/**
 * Configuration types
 */
export interface ControllerConfig {
  routerUrl: string;
  token: string;
  cardhostUuid?: string;
  verbose?: boolean;
}

export interface CardhostConfig {
  routerUrl: string;
  uuid?: string;
  signingPublicKey?: string;
  signingPrivateKey?: string;
}

export interface RouterConfig {
  port?: number;
  host?: string;
}