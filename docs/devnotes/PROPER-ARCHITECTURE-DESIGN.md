# Proper Architecture Design - Using jsapdu-over-ip

**Date**: 2025-12-09  
**Status**: 📐 Architecture Design Phase

## Overview

This document defines the correct architecture following:
- [`docs/what-to-make.md`](../what-to-make.md) - Project specification
- [`research/jsapdu-over-ip/`](../../research/jsapdu-over-ip/) - jsapdu-over-ip implementation
- [`research/jsapdu/`](../../research/jsapdu/) - jsapdu core abstractions

## Core Principle: Library-First Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Application                         │
│                      (User's Code)                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Runtime Layer                          │
│         (CLI tools, Standalone services)                    │
│    - controller-cli.ts                                      │
│    - cardhost-service.ts                                    │
│    - router-server.ts                                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Library Layer                          │
│         (Testable, Composable Classes)                      │
│    - ControllerClient                                       │
│    - CardhostService                                        │
│    - RouterService                                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   jsapdu-over-ip                            │
│    - RemoteSmartCardPlatform (client)                       │
│    - SmartCardPlatformAdapter (server)                      │
│    - Transport abstraction                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  jsapdu-interface                           │
│    - SmartCardPlatform                                      │
│    - SmartCardDevice                                        │
│    - SmartCard                                              │
│    - CommandApdu / ResponseApdu                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/
├── controller/
│   ├── src/
│   │   ├── lib/                          # Library (testable)
│   │   │   ├── index.ts                  # Public API exports
│   │   │   ├── controller-client.ts      # Main class
│   │   │   ├── session-manager.ts        # Session state
│   │   │   └── types.ts                  # Type definitions
│   │   └── runtime/                      # Runtime (CLI)
│   │       ├── cli.ts                    # Yargs CLI
│   │       └── commands/                 # Command handlers
│   │           ├── connect.ts
│   │           ├── send.ts
│   │           ├── interactive.ts
│   │           └── list.ts
│   ├── tests/                            # Co-located tests
│   │   ├── controller-client.test.ts
│   │   └── session-manager.test.ts
│   └── package.json
│
├── cardhost/
│   ├── src/
│   │   ├── lib/                          # Library (testable)
│   │   │   ├── index.ts                  # Public API exports
│   │   │   ├── cardhost-service.ts       # Main class
│   │   │   ├── config-manager.ts         # Config & UUID
│   │   │   ├── auth-manager.ts           # Challenge-response auth
│   │   │   ├── mock-platform.ts          # Mock for testing
│   │   │   └── types.ts                  # Type definitions
│   │   └── runtime/                      # Runtime (Service)
│   │       ├── main.ts                   # Service entry point
│   │       └── monitor.ts                # Monitor UI (optional)
│   ├── tests/
│   │   ├── cardhost-service.test.ts
│   │   ├── config-manager.test.ts
│   │   └── mock-platform.test.ts
│   └── package.json
│
├── router/
│   ├── src/
│   │   ├── lib/                          # Library (testable)
│   │   │   ├── index.ts                  # Public API exports
│   │   │   ├── router-service.ts         # Main router logic
│   │   │   ├── auth/                     # Authentication
│   │   │   │   ├── controller-auth.ts    # Bearer token
│   │   │   │   └── cardhost-auth.ts      # Public key + challenge
│   │   │   ├── relay/                    # Session relay
│   │   │   │   ├── session-relay.ts      # Relay manager
│   │   │   │   └── connection-pool.ts    # WebSocket pool
│   │   │   └── types.ts                  # Type definitions
│   │   └── runtime/                      # Runtime (Server)
│   │       ├── server.ts                 # Hono server
│   │       └── routes/                   # HTTP routes
│   │           ├── controller-routes.ts
│   │           ├── cardhost-routes.ts
│   │           └── websocket-handler.ts
│   ├── tests/
│   │   ├── router-service.test.ts
│   │   ├── controller-auth.test.ts
│   │   └── cardhost-auth.test.ts
│   └── package.json
│
└── shared/                               # ONLY shared types/utilities
    ├── src/
    │   ├── types/                        # Shared type definitions
    │   │   ├── auth.ts                   # Auth types
    │   │   └── config.ts                 # Config types
    │   └── utils/                        # Minimal utilities
    │       └── uuid.ts                   # UUID generation
    └── package.json
```

---

## Component Designs

### 1. Controller Library

#### ControllerClient Class

```typescript
// packages/controller/src/lib/controller-client.ts
import { RemoteSmartCardPlatform, FetchClientTransport } from '@aokiapp/jsapdu-over-ip/client';
import { CommandApdu, ResponseApdu } from '@aokiapp/jsapdu-interface';
import type { SessionManager } from './session-manager.js';

export interface ControllerClientConfig {
  routerUrl: string;
  token: string;
  cardhostUuid?: string;
}

export class ControllerClient {
  private platform: RemoteSmartCardPlatform | null = null;
  private sessionManager: SessionManager;
  
  constructor(private config: ControllerClientConfig) {
    this.sessionManager = new SessionManager(config);
  }
  
  /**
   * Connect to Router and establish session with Cardhost
   */
  async connect(cardhostUuid?: string): Promise<void> {
    const uuid = cardhostUuid ?? this.config.cardhostUuid;
    if (!uuid) {
      throw new Error('Cardhost UUID required');
    }
    
    // Authenticate with Router (get session token)
    const sessionToken = await this.sessionManager.authenticate();
    
    // Create transport for jsapdu-over-ip
    const transport = new FetchClientTransport(
      `${this.config.routerUrl}/api/jsapdu/rpc`,
      {
        headers: {
          'x-session-token': sessionToken,
          'x-cardhost-uuid': uuid
        }
      }
    );
    
    // Create RemoteSmartCardPlatform (jsapdu-over-ip handles E2E encryption)
    this.platform = new RemoteSmartCardPlatform(transport);
    await this.platform.init();
  }
  
  /**
   * List available Cardhosts from Router
   */
  async listCardhosts(): Promise<Array<{ uuid: string; connected: boolean }>> {
    return this.sessionManager.listCardhosts();
  }
  
  /**
   * Get platform (jsapdu-interface compatible)
   */
  getPlatform(): RemoteSmartCardPlatform {
    if (!this.platform) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.platform;
  }
  
  /**
   * Send APDU command (convenience method)
   */
  async transmit(command: CommandApdu): Promise<ResponseApdu> {
    const platform = this.getPlatform();
    
    // Use jsapdu pattern: platform → device → card → transmit
    const devices = await platform.getDeviceInfo();
    if (devices.length === 0) {
      throw new Error('No devices available');
    }
    
    await using device = await platform.acquireDevice(devices[0].id);
    await using card = await device.startSession();
    
    return await card.transmit(command);
  }
  
  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.platform) {
      await this.platform.release();
      this.platform = null;
    }
  }
  
  /**
   * Async disposal support
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}
```

#### SessionManager Class

```typescript
// packages/controller/src/lib/session-manager.ts
import { fetch } from 'undici';

export class SessionManager {
  private sessionToken: string | null = null;
  
  constructor(private config: { routerUrl: string; token: string }) {}
  
  async authenticate(): Promise<string> {
    if (this.sessionToken) {
      return this.sessionToken;
    }
    
    const response = await fetch(`${this.config.routerUrl}/controller/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.statusText}`);
    }
    
    const data = await response.json() as { token: string; expiresAt: string };
    this.sessionToken = data.token;
    
    return this.sessionToken;
  }
  
  async listCardhosts(): Promise<Array<{ uuid: string; connected: boolean }>> {
    const response = await fetch(`${this.config.routerUrl}/cardhosts`, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list cardhosts: ${response.statusText}`);
    }
    
    return await response.json() as Array<{ uuid: string; connected: boolean }>;
  }
}
```

---

### 2. Cardhost Library

#### CardhostService Class

```typescript
// packages/cardhost/src/lib/cardhost-service.ts
import { SmartCardPlatformAdapter } from '@aokiapp/jsapdu-over-ip/server';
import { PcscPlatform } from '@aokiapp/jsapdu-pcsc';
import type { SmartCardPlatform } from '@aokiapp/jsapdu-interface';
import type { ServerTransport } from '@aokiapp/jsapdu-over-ip';
import type { ConfigManager } from './config-manager.js';
import type { AuthManager } from './auth-manager.js';

export interface CardhostServiceConfig {
  routerUrl: string;
  platform?: SmartCardPlatform;  // Allow mock for testing
}

export class CardhostService {
  private platform: SmartCardPlatform;
  private adapter: SmartCardPlatformAdapter | null = null;
  private configManager: ConfigManager;
  private authManager: AuthManager;
  
  constructor(
    config: CardhostServiceConfig,
    configManager: ConfigManager,
    authManager: AuthManager
  ) {
    this.configManager = configManager;
    this.authManager = authManager;
    
    // Use provided platform or create PcscPlatform
    this.platform = config.platform ?? new PcscPlatform();
  }
  
  /**
   * Connect to Router and register Cardhost
   */
  async connect(): Promise<void> {
    // Load or generate UUID and keypair
    const config = await this.configManager.loadOrCreate();
    
    // Authenticate with Router (challenge-response)
    await this.authManager.authenticate(config);
    
    // Create transport for jsapdu-over-ip server side
    const transport = await this.createServerTransport(config);
    
    // Create SmartCardPlatformAdapter (jsapdu-over-ip handles RPC)
    this.adapter = new SmartCardPlatformAdapter(this.platform, transport);
    await this.adapter.start();
  }
  
  private async createServerTransport(config: any): Promise<ServerTransport> {
    // Implementation depends on transport type
    // Could be WebSocket-based, HTTP polling, etc.
    // This will be implemented based on Router's transport offering
    throw new Error('Not implemented yet');
  }
  
  /**
   * Get cardhost UUID
   */
  getUuid(): string {
    return this.configManager.getUuid();
  }
  
  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (this.adapter) {
      await this.adapter.stop();
      this.adapter = null;
    }
  }
  
  /**
   * Async disposal support
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}
```

#### MockPlatform for Testing

```typescript
// packages/cardhost/src/lib/mock-platform.ts
import { 
  SmartCardPlatform, 
  SmartCardDevice,
  SmartCard,
  SmartCardDeviceInfo,
  CommandApdu,
  ResponseApdu
} from '@aokiapp/jsapdu-interface';

export class MockSmartCardPlatform extends SmartCardPlatform {
  private devices: Map<string, MockSmartCardDevice> = new Map();
  
  async init(): Promise<void> {
    this.assertNotInitialized();
    this.initialized = true;
    
    // Create mock device
    const deviceInfo = new MockDeviceInfo('mock-device-1');
    const device = new MockSmartCardDevice(this, deviceInfo);
    this.devices.set(deviceInfo.id, device);
  }
  
  async release(): Promise<void> {
    this.assertInitialized();
    this.devices.clear();
    this.initialized = false;
  }
  
  async getDeviceInfo(): Promise<SmartCardDeviceInfo[]> {
    this.assertInitialized();
    return Array.from(this.devices.values()).map(d => d.getDeviceInfo());
  }
  
  async acquireDevice(id: string): Promise<SmartCardDevice> {
    this.assertInitialized();
    const device = this.devices.get(id);
    if (!device) {
      throw new Error(`Device ${id} not found`);
    }
    return device;
  }
}

class MockDeviceInfo extends SmartCardDeviceInfo {
  constructor(public readonly id: string) {
    super();
  }
  
  readonly supportsApdu = true;
  readonly supportsHce = false;
  readonly isIntegratedDevice = false;
  readonly isRemovableDevice = true;
  readonly d2cProtocol = 'iso7816' as const;
  readonly p2dProtocol = 'usb' as const;
  readonly apduApi = ['mock'];
}

class MockSmartCardDevice extends SmartCardDevice {
  constructor(
    parentPlatform: SmartCardPlatform,
    private deviceInfo: MockDeviceInfo
  ) {
    super(parentPlatform);
  }
  
  getDeviceInfo(): SmartCardDeviceInfo {
    return this.deviceInfo;
  }
  
  isSessionActive(): boolean {
    return this.card !== null;
  }
  
  async isDeviceAvailable(): Promise<boolean> {
    return true;
  }
  
  async isCardPresent(): Promise<boolean> {
    return true;
  }
  
  async startSession(): Promise<SmartCard> {
    if (this.card) {
      throw new Error('Session already active');
    }
    this.card = new MockSmartCard(this);
    return this.card;
  }
  
  async waitForCardPresence(timeout: number): Promise<void> {
    // Mock: card is always present
    return;
  }
  
  async startHceSession(): Promise<never> {
    throw new Error('HCE not supported');
  }
  
  async release(): Promise<void> {
    if (this.card) {
      await this.card.release();
      this.card = null;
    }
  }
}

class MockSmartCard extends SmartCard {
  constructor(parentDevice: SmartCardDevice) {
    super(parentDevice);
  }
  
  async getAtr(): Promise<Uint8Array> {
    return new Uint8Array([0x3B, 0x00]); // Minimal ATR
  }
  
  async transmit(apdu: CommandApdu): Promise<ResponseApdu>;
  async transmit(apdu: Uint8Array): Promise<Uint8Array>;
  async transmit(apdu: CommandApdu | Uint8Array): Promise<ResponseApdu | Uint8Array> {
    // Mock: always return success (9000)
    if (apdu instanceof CommandApdu) {
      return new ResponseApdu(new Uint8Array(0), 0x90, 0x00);
    } else {
      return new Uint8Array([0x90, 0x00]);
    }
  }
  
  async reset(): Promise<void> {
    // Mock: no-op
  }
  
  async release(): Promise<void> {
    // Mock: no-op
  }
}
```

---

### 3. Router Library

#### RouterService Class

```typescript
// packages/router/src/lib/router-service.ts
import type { ControllerAuth } from './auth/controller-auth.js';
import type { CardhostAuth } from './auth/cardhost-auth.js';
import type { SessionRelay } from './relay/session-relay.js';

export interface RouterServiceConfig {
  port?: number;
  // Add other config options
}

export class RouterService {
  private controllerAuth: ControllerAuth;
  private cardhostAuth: CardhostAuth;
  private sessionRelay: SessionRelay;
  private running = false;
  
  constructor(
    config: RouterServiceConfig,
    controllerAuth: ControllerAuth,
    cardhostAuth: CardhostAuth,
    sessionRelay: SessionRelay
  ) {
    this.controllerAuth = controllerAuth;
    this.cardhostAuth = cardhostAuth;
    this.sessionRelay = sessionRelay;
  }
  
  /**
   * Start Router service (library method, doesn't start HTTP server)
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Router already running');
    }
    
    await this.sessionRelay.initialize();
    this.running = true;
  }
  
  /**
   * Stop Router service
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    await this.sessionRelay.shutdown();
    this.running = false;
  }
  
  /**
   * Handle controller authentication
   */
  async authenticateController(bearerToken: string): Promise<string> {
    return this.controllerAuth.authenticate(bearerToken);
  }
  
  /**
   * Handle cardhost authentication (step 1: issue challenge)
   */
  async initiateCardhostAuth(uuid: string, publicKey: string): Promise<string> {
    return this.cardhostAuth.initiateAuth(uuid, publicKey);
  }
  
  /**
   * Handle cardhost authentication (step 2: verify signature)
   */
  async verifyCardhostAuth(
    uuid: string,
    challenge: string,
    signature: string
  ): Promise<boolean> {
    return this.cardhostAuth.verifyAuth(uuid, challenge, signature);
  }
  
  /**
   * Create relay session between controller and cardhost
   */
  async createSession(
    controllerSessionToken: string,
    cardhostUuid: string
  ): Promise<string> {
    return this.sessionRelay.createSession(controllerSessionToken, cardhostUuid);
  }
  
  /**
   * List connected cardhosts
   */
  listCardhosts(): Array<{ uuid: string; connected: boolean }> {
    return this.cardhostAuth.listCardhosts();
  }
  
  /**
   * Get session relay (for WebSocket handler)
   */
  getSessionRelay(): SessionRelay {
    return this.sessionRelay;
  }
}
```

---

## Key Design Decisions

### 1. jsapdu-over-ip Integration

**Controller uses `RemoteSmartCardPlatform`**:
- jsapdu-over-ip handles E2E encryption (ECDH + AES-GCM)
- jsapdu-over-ip handles RPC serialization
- We just provide the transport layer

**Cardhost uses `SmartCardPlatformAdapter`**:
- Wraps actual `PcscPlatform` or `MockPlatform`
- jsapdu-over-ip handles RPC server side
- We just provide the transport layer

**Router is a Transport Bridge**:
- Router doesn't understand jsapdu protocol
- Router just relays transport messages
- Authentication and session management are Router's responsibility

### 2. Resource Management with `await using`

All components support `Symbol.asyncDispose`:

```typescript
// Correct usage (auto-cleanup)
await using controller = new ControllerClient(config);
await controller.connect(uuid);
await controller.transmit(command);
// Auto-cleanup on scope exit

// Also works with jsapdu pattern
await using platform = controller.getPlatform();
await using device = await platform.acquireDevice(id);
await using card = await device.startSession();
const response = await card.transmit(command);
// All cleanup happens automatically
```

### 3. Testing Strategy

**Unit Tests** - Test classes in isolation:
```typescript
describe('ControllerClient', () => {
  it('should connect to router', async () => {
    const mockSessionManager = vi.mock(SessionManager);
    const client = new ControllerClient(config, mockSessionManager);
    await client.connect('uuid');
    expect(mockSessionManager.authenticate).toHaveBeenCalled();
  });
});
```

**Integration Tests** - Test class interactions:
```typescript
describe('Cardhost + MockPlatform', () => {
  it('should handle APDU via adapter', async () => {
    const mockPlatform = new MockSmartCardPlatform();
    const cardhost = new CardhostService({ platform: mockPlatform }, ...);
    await cardhost.connect();
    // Test adapter interaction
  });
});
```

**E2E Tests** - Full system flow:
```typescript
describe('Full System', () => {
  it('should relay APDU from controller to cardhost', async () => {
    const router = new RouterService(...);
    await router.start();
    
    const mockPlatform = new MockSmartCardPlatform();
    const cardhost = new CardhostService({ platform: mockPlatform }, ...);
    await cardhost.connect();
    
    const controller = new ControllerClient({ routerUrl: router.url, ... });
    await controller.connect(cardhost.getUuid());
    
    const command = new CommandApdu(0x00, 0xA4, 0x04, 0x00, ...);
    const response = await controller.transmit(command);
    
    expect(response.sw).toBe(0x9000);
  });
});
```

---

## Implementation Order

1. ✅ **Setup**: Add jsapdu-over-ip dependency
2. ✅ **Cardhost Library**: Implement with MockPlatform
3. ✅ **Router Library**: Implement core relay logic
4. ✅ **Controller Library**: Implement with RemoteSmartCardPlatform
5. ✅ **Unit Tests**: Test each component
6. ✅ **Integration Tests**: Test interactions
7. ✅ **E2E Tests**: Full system test
8. ✅ **Runtime Wrappers**: CLI and services
9. ✅ **Documentation**: Update based on implementation

---

## Success Criteria

- [ ] `@aokiapp/jsapdu-over-ip` is used throughout
- [ ] All components are libraries (exportable, testable)
- [ ] All components support `await using`
- [ ] Runtime wrappers are thin (< 100 lines)
- [ ] Unit tests cover 80%+ of library code
- [ ] Integration tests cover all interactions
- [ ] E2E test runs complete Controller → Router → Cardhost flow
- [ ] Tests are meaningful (not just passing)

---

## References

- Specification: [`docs/what-to-make.md`](../what-to-make.md)
- jsapdu Abstracts: [`research/jsapdu/packages/interface/src/abstracts.ts`](../../research/jsapdu/packages/interface/src/abstracts.ts)
- jsapdu-over-ip Client: [`research/jsapdu-over-ip/src/client/platform-proxy.ts`](../../research/jsapdu-over-ip/src/client/platform-proxy.ts)
- jsapdu-over-ip Server: [`research/jsapdu-over-ip/src/server/platform-adapter.ts`](../../research/jsapdu-over-ip/src/server/platform-adapter.ts)