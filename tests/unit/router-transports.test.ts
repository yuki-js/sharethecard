/**
 * Unit Tests for Router Transport Layer
 * 
 * Tests Transport classes with mocked WebSocket/dependencies
 * Validates message handling, event emission, and error cases
 * 
 * Spec: docs/what-to-make.md Section 6.2.1 - ユニットテスト
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("RouterClientTransport (Controller) - Unit", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("call() requires connected transport", async () => {
    const { RouterClientTransport, WsAuthenticator } = await import("@remote-apdu/controller");

    // Mock authenticator
    const mockAuth = {
      getWebSocket: vi.fn(() => ({ readyState: 1 })),
    } as any;

    const transport = new RouterClientTransport({
      authenticator: mockAuth,
    });

    const req = { id: "req-1", method: "platform.init", params: [] };

    // Should throw because transport not started
    await expect(transport.call(req as any)).rejects.toThrow("Transport not connected");
  });

  it("isConnected() returns false when not started", async () => {
    const { RouterClientTransport } = await import("@remote-apdu/controller");

    const mockAuth = {
      getWebSocket: vi.fn(),
    } as any;

    const transport = new RouterClientTransport({
      authenticator: mockAuth,
    });

    expect(transport.isConnected()).toBe(false);
  });
});

describe("RouterServerTransport (Cardhost) - Unit", () => {
  it("emitEvent() sends rpc-event envelope when ws is OPEN", async () => {
    const { RouterServerTransport } = await import("@remote-apdu/cardhost");

    const mockAuth = {
      getWebSocket: vi.fn(),
    } as any;

    const transport = new RouterServerTransport({
      authenticator: mockAuth,
    });

    const sendSpy = vi.fn();
    // Simulate WebSocket OPEN = 1
    (transport as any).ws = { readyState: 1, send: sendSpy };

    const event = { type: "DEVICE_EVENT", data: { message: "hello" } } as any;
    transport.emitEvent(event);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0][0];
    const parsed = JSON.parse(arg);
    expect(parsed.type).toBe("rpc-event");
    expect(parsed.payload).toEqual(event);
  });

  it("handleMessage() processes rpc-request and replies with rpc-response using request handler", async () => {
    const { RouterServerTransport } = await import("@remote-apdu/cardhost");

    const mockAuth = {
      getWebSocket: vi.fn(),
    } as any;

    const transport = new RouterServerTransport({
      authenticator: mockAuth,
    });

    const sendSpy = vi.fn();
    (transport as any).ws = { readyState: 1, send: sendSpy };

    // Register handler via public API
    const handler = vi.fn(async (request: any) => {
      expect(request.id).toBe("req-xyz");
      expect(request.method).toBe("platform.init");
      return { id: request.id, result: null };
    });
    transport.onRequest(handler);

    // Invoke private method directly (TS private not enforced at runtime)
    const envelope = {
      type: "rpc-request",
      id: "msg-123", // WebSocket message ID
      payload: { id: "req-xyz", method: "platform.init", params: [false] },
    };
    await (transport as any).handleMessage(JSON.stringify(envelope));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(sent.type).toBe("rpc-response");
    expect(sent.id).toBe("msg-123"); // WebSocket message ID should be preserved
    expect(sent.payload.id).toBe("req-xyz");
    expect(sent.payload.result).toBeNull();
  });

  it("isConnected() returns false when not started", async () => {
    const { RouterServerTransport } = await import("@remote-apdu/cardhost");

    const mockAuth = {
      getWebSocket: vi.fn(),
    } as any;

    const transport = new RouterServerTransport({
      authenticator: mockAuth,
    });

    expect(transport.isConnected()).toBe(false);
  });
});
