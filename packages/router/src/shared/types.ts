/**
 * Router-local shared types
 * Moved from @remote-apdu/shared to comply with the policy:
 * - Shared must be environment-agnostic AND actually shared across multiple modules.
 * - These types are only used by the Router.
 */

export interface SessionToken {
  token: string;
  expiresAt: string;
}

export interface CardhostInfo {
  uuid: string;
  connected: boolean;
}

export interface RouterConfig {
  port?: number;
  host?: string;
}