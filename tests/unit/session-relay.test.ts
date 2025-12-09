import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('SessionRelay - Unit via RouterService access', () => {
  let router: any;

  beforeEach(async () => {
    const { RouterService } = await import('@remote-apdu/router');
    router = new RouterService();
    await router.start();
  });

  afterEach(async () => {
    if (router) {
      await router.stop();
      router = null;
    }
  });

  it('relayToCardhost() returns response when Cardhost sends rpc-response', async () => {
    const relay = router.getSessionRelay();

    // Create a session directly on the relay (bypassing auth for unit-level test)
    const controllerSessionToken = 'sess_UNIT_1';
    const cardhostUuid = 'uuid-unit-1';
    relay.createSession(controllerSessionToken, cardhostUuid);

    // Register a Cardhost "connection" that echoes a response via handleCardhostMessage
    relay.registerCardhostConnection(cardhostUuid, {
      id: 'conn-1',
      role: 'cardhost',
      identifier: cardhostUuid,
      send: (payload: unknown) => {
        // Simulate cardhost receiving rpc-request and replying with rpc-response
        try {
          const raw = String(payload);
          const msg = JSON.parse(raw);
          const req = msg?.payload ?? {};
          setTimeout(() => {
            relay.handleCardhostMessage(
              cardhostUuid,
              JSON.stringify({
                type: 'rpc-response',
                payload: { id: req.id, result: [{ id: 'mock-device-1' }] }
              })
            );
          }, 0);
        } catch {
          // ignore in test
        }
      }
    });

    const request = { id: 'req-1', method: 'platform.getDeviceInfo', params: [] };
    const resp = await relay.relayToCardhost(controllerSessionToken, request as any);

    expect(resp).toBeTruthy();
    expect(resp.id).toBe('req-1');
    expect(Array.isArray(resp.result)).toBe(true);
    expect(resp.result[0]).toEqual({ id: 'mock-device-1' });
  });

  it('relayToCardhost() returns NO_RELAY_SESSION when no session exists', async () => {
    const relay = router.getSessionRelay();

    const request = { id: 'req-no-session', method: 'platform.init', params: [] };
    const resp = await relay.relayToCardhost('missing-session', request as any);

    expect(resp.error).toBeTruthy();
    expect(resp.error.code).toBe('NO_RELAY_SESSION');
  });

  it('relayToCardhost() returns CARDHOST_OFFLINE when Cardhost not registered', async () => {
    const relay = router.getSessionRelay();

    const controllerSessionToken = 'sess_UNIT_2';
    const cardhostUuid = 'uuid-unit-2';
    relay.createSession(controllerSessionToken, cardhostUuid);

    const request = { id: 'req-offline', method: 'platform.init', params: [] };
    const resp = await relay.relayToCardhost(controllerSessionToken, request as any);

    expect(resp.error).toBeTruthy();
    expect(resp.error.code).toBe('CARDHOST_OFFLINE');
  });
});