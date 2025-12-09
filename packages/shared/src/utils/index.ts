/**
 * Shared utility functions for Remote APDU System
 */

import { webcrypto } from 'node:crypto';

/**
 * Generate a UUID v4 (128-bit)
 * Used for Cardhost identification
 */
export function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  
  // RFC 4122 v4 variant
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}

/**
 * Validate UUID format
 */
export function isValidUuid(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

/**
 * Generate cryptographically secure random base64 string
 */
export function generateRandomBase64(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  webcrypto.getRandomValues(buffer);
  return Buffer.from(buffer).toString('base64');
}