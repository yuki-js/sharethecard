/**
 * Canonical JSON utilities
 *
 * Purpose:
 * - Provide a single, shared implementation for canonical JSON string/bytes
 * - Used for Ed25519 signing and verification to ensure deterministic payloads
 *
 * Notes:
 * - Keys are sorted recursively (lexicographic order)
 * - Arrays maintain original order
 * - Non-object/array values are returned as-is
 */

/**
 * Create a canonical JSON UTF-8 byte array from any input.
 * Keys are sorted recursively to ensure deterministic output.
 */
export function canonicalizeJson(input: unknown): Uint8Array {
  const canonical = JSON.stringify(sortKeys(input));
  return new Uint8Array(Buffer.from(canonical, 'utf8'));
}

/**
 * Internal: Recursively sort object keys lexicographically.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeys(v));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const obj: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      obj[k] = sortKeys(v);
    }
    return obj;
  }
  return value;
}