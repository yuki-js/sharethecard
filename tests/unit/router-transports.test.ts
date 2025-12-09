import { describe, it, expect, beforeEach, vi } from 'vitest';

// RouterClientTransport unit tests (Controller side)
const mockFetch = vi.fn();
vi.mock('undici', () => ({
  fetch: mockFetch
}));

function mkResponse(ok: boolean, status: number, body: any) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'ERROR',
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

describe('RouterClientTransport (Controller) - Unit', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });


  it('call() throws on invalid RpcResponse format from server', async () => {
    const { RouterClientTransport } = await import('@remote-apdu/controller');

    const transport = new RouterClientTransport({
      rpcEndpoint: 'http://router.example.com/api/jsapdu/rpc',
      sessionToken: 'sess_456',
      cardhostUuid: 'uuid-def'
    });

    const req = { id: 'req-2', method: 'platform.getDeviceInfo', params: [] };

    mockFetch.mockImplementation(async () => mkResponse(true, 200, { notAnRpcResponse: true }));

    await expect(transport.call(req as any)).rejects.toThrow(/Invalid RpcResponse format/i);
  });
});

// RouterServerTransport unit tests (Cardhost side)
describe('RouterServerTransport (Cardhost) - Unit', () => {
  it('emitEvent() sends rpc-event envelope when ws is OPEN', async () => {
    const { RouterServerTransport } = await import('@remote-apdu/cardhost');

    const transport = new RouterServerTransport({
      routerUrl: 'ws://router.example.com',
      cardhostUuid: 'uuid-abc'
    });

    const sendSpy = vi.fn();
    // Simulate WebSocket OPEN = 1
    (transport as any).ws = { readyState: 1, send: sendSpy };

    const event = { type: 'DEVICE_EVENT', data: { message: 'hello' } } as any;
    transport.emitEvent(event);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const arg = sendSpy.mock.calls[0][0];
    const parsed = JSON.parse(arg);
    expect(parsed.type).toBe('rpc-event');
    expect(parsed.payload).toEqual(event);
  });

  it('handleMessage() processes rpc-request and replies with rpc-response using request handler', async () => {
    const { RouterServerTransport } = await import('@remote-apdu/cardhost');

    const transport = new RouterServerTransport({
      routerUrl: 'ws://router.example.com',
      cardhostUuid: 'uuid-abc'
    });

    const sendSpy = vi.fn();
    (transport as any).ws = { readyState: 1, send: sendSpy };

    // Register handler via public API
    const handler = vi.fn(async (request: any) => {
      expect(request.id).toBe('req-xyz');
      expect(request.method).toBe('platform.init');
      return { id: request.id, result: null };
    });
    transport.onRequest(handler);

    // Invoke private method directly (TS private not enforced at runtime)
    const envelope = { type: 'rpc-request', payload: { id: 'req-xyz', method: 'platform.init', params: [false] } };
    await (transport as any).handleMessage(JSON.stringify(envelope));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(sendSpy.mock.calls[0][0]);
    expect(sent.type).toBe('rpc-response');
    expect(sent.payload.id).toBe('req-xyz');
    expect(sent.payload.result).toBeNull();
  });

});