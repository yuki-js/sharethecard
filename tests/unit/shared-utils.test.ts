import { describe, it, expect } from "vitest";

import { toBase64, fromBase64, toUtf8, prepareSigningPayload } from "../../packages/shared/src/utils/encoding.ts";
import { canonicalizeJson } from "../../packages/shared/src/utils/canonical-json.ts";

describe("shared utils - encoding/base64", () => {
  it("round-trips base64 encode/decode", () => {
    const input = new Uint8Array([0, 1, 2, 3, 255]);
    const b64 = toBase64(input);
    const output = fromBase64(b64);
    expect(Array.from(output)).toEqual(Array.from(input));
  });

  it("UTF-8 encoding works", () => {
    const text = "hello";
    const bytes = toUtf8(text);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe(text);
  });
});

describe("shared utils - canonical JSON", () => {
  it("canonicalizes object keys lexicographically", () => {
    const obj = { b: 2, a: 1, c: { y: 2, x: 1 } };
    const canonicalBytes = canonicalizeJson(obj);
    const canonicalStr = new TextDecoder().decode(canonicalBytes);
    // Keys should be sorted: a, b, c; nested x, y
    expect(canonicalStr).toBe('{"a":1,"b":2,"c":{"x":1,"y":2}}');
  });

  it("prepareSigningPayload uses canonicalization", () => {
    const data = { z: 3, a: 1 };
    const payload = prepareSigningPayload(data);
    const str = new TextDecoder().decode(payload);
    expect(str).toBe('{"a":1,"z":3}');
  });

  it("canonicalization preserves array order", () => {
    const data = { arr: [3, 1, 2] };
    const canonicalBytes = canonicalizeJson(data);
    const canonicalStr = new TextDecoder().decode(canonicalBytes);
    expect(canonicalStr).toBe('{"arr":[3,1,2]}');
  });
});