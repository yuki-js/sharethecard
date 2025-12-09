# Testing Guide

Comprehensive guide for writing and running tests in the Remote APDU Communication System.

## Overview

The test suite consists of three levels:

1. **Unit Tests** - Individual functions and classes in isolation
2. **Integration Tests** - Multiple components working together
3. **E2E Tests** - Complete system flows with all components

## Test Framework

- **Framework**: Vitest
- **Language**: TypeScript
- **Assertion Library**: Node's native assert + Vitest matchers

### Setup

```bash
# Run all tests
npm test

# Run with watch mode
npm test -- --watch

# Run specific file
npm test -- crypto-encryption.test.ts

# Run matching pattern
npm test -- --grep "ECDH"

# Generate coverage
npm test -- --coverage
```

## Unit Tests

### Purpose

Test individual functions and classes in isolation with mocked dependencies.

**Location**: `tests/unit/`

### Examples

#### Encryption Tests

```typescript
import { describe, it, expect } from 'vitest';
import { encryptAesGcm, decryptAesGcm, generateIv } from '@remote-apdu/shared';

describe('Encryption Utilities', () => {
  describe('generateIv', () => {
    it('should generate a 12-byte IV', () => {
      const iv = generateIv();
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.byteLength).toBe(12);
    });

    it('should generate different IVs on each call', () => {
      const iv1 = generateIv();
      const iv2 = generateIv();
      expect(iv1).not.toEqual(iv2);
    });
  });

  describe('encryptAesGcm', () => {
    it('should encrypt plaintext with 32-byte key', () => {
      const plaintext = new Uint8Array(Buffer.from('Hello, World!', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const result = encryptAesGcm(plaintext, key);

      expect(result).toHaveProperty('iv');
      expect(result).toHaveProperty('ciphertext');
      expect(result).toHaveProperty('authTag');
    });

    it('should throw error if key is not 32 bytes', () => {
      const plaintext = new Uint8Array(Buffer.from('Hello', 'utf8'));
      const badKey = new Uint8Array(16);

      expect(() => encryptAesGcm(plaintext, badKey))
        .toThrow('AES-256-GCM requires a 32-byte key');
    });
  });

  describe('Encrypt/Decrypt Round Trip', () => {
    it('should decrypt encrypted payload correctly', () => {
      const plaintext = new Uint8Array(Buffer.from('Secret Message', 'utf8'));
      const key = new Uint8Array(32);
      crypto.getRandomValues(key);

      const encrypted = encryptAesGcm(plaintext, key);
      const decrypted = decryptAesGcm(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });
  });
});
```

#### Signing Tests

```typescript
describe('Ed25519 Signing', () => {
  it('should verify valid signature', () => {
    const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
    const payload = new Uint8Array(Buffer.from('verify me', 'utf8'));

    const signature = signDetachedEd25519(payload, privateKeyPkcs8Base64);
    const isValid = verifyDetachedEd25519(payload, publicKeySpkiBase64, signature);

    expect(isValid).toBe(true);
  });

  it('should reject tampered data', () => {
    const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
    const payload = new Uint8Array(Buffer.from('original', 'utf8'));
    const tampered = new Uint8Array(Buffer.from('tampered', 'utf8'));

    const signature = signDetachedEd25519(payload, privateKeyPkcs8Base64);
    const isValid = verifyDetachedEd25519(tampered, publicKeySpkiBase64, signature);

    expect(isValid).toBe(false);
  });
});
```

### Best Practices

✅ **Do**:
- Test one concept per test
- Use descriptive test names
- Test happy path, edge cases, and error cases
- Use setup/teardown with `beforeEach`/`afterEach`
- Mock external dependencies

❌ **Don't**:
- Test multiple unrelated things in one test
- Use vague names like "test something"
- Skip error cases
- Leave test state between tests
- Make actual network calls

### Running Unit Tests

```bash
# All unit tests
npm run test:unit

# Watch mode
npm run test:unit -- --watch

# Specific file
npm run test:unit -- crypto-signing.test.ts

# Coverage
npm run test:unit -- --coverage
```

## Integration Tests

### Purpose

Test multiple components working together, ensuring they integrate correctly.

**Location**: `tests/integration/`

### Example: Router Authentication

```typescript
import { describe, it, expect } from 'vitest';
import { fetch } from 'undici';
import { generateEd25519KeyPairBase64, signJsonEd25519 } from '@remote-apdu/shared';

const ROUTER_URL = 'http://localhost:3000';

describe('Router Authentication Flows', () => {
  describe('Controller Bearer Token Authentication', () => {
    it('should accept valid bearer token and issue session', async () => {
      const validToken = 'test-bearer-token-12345';

      const res = await fetch(`${ROUTER_URL}/controller/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`
        }
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toHaveProperty('token');
      expect(body).toHaveProperty('expiresAt');
    });

    it('should reject invalid bearer token', async () => {
      const res = await fetch(`${ROUTER_URL}/controller/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer short'
        }
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Cardhost Public Key Authentication', () => {
    it('should verify signed challenge', async () => {
      const { publicKeySpkiBase64, privateKeyPkcs8Base64 } = generateEd25519KeyPairBase64();
      const testUuid = '550e8400-e29b-41d4-a716-446655440000';

      // Step 1: Get challenge
      const connectRes = await fetch(`${ROUTER_URL}/cardhost/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: testUuid,
          publicKey: publicKeySpkiBase64
        })
      });

      expect(connectRes.ok).toBe(true);
      const { challenge } = await connectRes.json();

      // Step 2: Sign challenge
      const signature = signJsonEd25519(challenge, privateKeyPkcs8Base64);

      // Step 3: Verify
      const verifyRes = await fetch(`${ROUTER_URL}/cardhost/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: testUuid,
          publicKey: publicKeySpkiBase64,
          signature,
          challenge
        })
      });

      expect(verifyRes.ok).toBe(true);
      const result = await verifyRes.json();
      expect(result.ok).toBe(true);
    });
  });
});
```

### Best Practices

✅ **Do**:
- Use real HTTP/WebSocket where possible
- Test actual data flows
- Include error scenarios
- Clean up resources after tests
- Use reasonable timeouts

❌ **Don't**:
- Mock everything (defeats purpose)
- Ignore errors
- Leave test servers running
- Use overly long timeouts

### Running Integration Tests

```bash
# Start services first
PORT=3000 npm run dev -w @remote-apdu/router &
ROUTER_URL=http://localhost:3000 npm run dev -w @remote-apdu/cardhost &

# Run tests in another terminal
npm run test:integration

# Stop services
kill %1 %2
```

## E2E Tests

### Purpose

Test complete system flows from user perspective, validating all components work together.

**Location**: `tests/e2e/`

### Example: Complete APDU Flow

```typescript
describe('E2E: Complete APDU Send/Receive', () => {
  it('should complete full APDU transaction', async () => {
    // 1. Setup: Create encryption session
    const controllerEphemeral = generateX25519KeyPairBase64();
    const cardhostEphemeral = generateX25519KeyPairBase64();

    const sharedSecret = computeSharedSecretX25519(
      controllerEphemeral.privateKeyPkcs8Base64,
      cardhostEphemeral.publicKeySpkiBase64
    );

    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const info = new Uint8Array(Buffer.from('remote-apdu-session', 'utf8'));
    const sessionKey = deriveSessionKey(sharedSecret, salt, info);

    // 2. Controller sends encrypted APDU
    const apduCommand = { hex: '00A4040008A000000003000000' };
    const plaintext = new Uint8Array(Buffer.from(JSON.stringify(apduCommand), 'utf8'));
    const encrypted = encryptAesGcm(plaintext, sessionKey);

    // 3. Router relays to Cardhost (no decryption)

    // 4. Cardhost decrypts and executes
    const decrypted = decryptAesGcm(encrypted, sessionKey);
    const receivedCommand = JSON.parse(Buffer.from(decrypted).toString('utf8'));

    expect(receivedCommand.hex).toBe(apduCommand.hex);

    // 5. Cardhost sends response (encrypted)
    const response = { dataHex: 'A4', sw: '9000' };
    const respPlaintext = new Uint8Array(Buffer.from(JSON.stringify(response), 'utf8'));
    const respEncrypted = encryptAesGcm(respPlaintext, sessionKey);

    // 6. Router relays response to Controller

    // 7. Controller decrypts response
    const decryptedResp = decryptAesGcm(respEncrypted, sessionKey);
    const receivedResp = JSON.parse(Buffer.from(decryptedResp).toString('utf8'));

    expect(receivedResp.sw).toBe('9000');
    expect(receivedResp.dataHex).toBe('A4');
  });
});
```

### Best Practices

✅ **Do**:
- Test complete user scenarios
- Validate all components together
- Include timing considerations
- Test error recovery
- Run in isolated environment

❌ **Don't**:
- Mock core functionality (use real implementations)
- Test individual components (use unit tests instead)
- Leave test data/servers
- Use hardcoded delays (use proper sync)

### Running E2E Tests

```bash
# Ensure services are running
npm run test:e2e

# With verbose output
npm run test:e2e -- --reporter=verbose

# Single scenario
npm run test:e2e -- --grep "APDU flow"
```

## Test Coverage

### Coverage Goals

| Component | Target | Rationale |
|-----------|--------|-----------|
| Crypto utilities | 100% | Critical for security |
| Authentication | 95% | Important for security |
| Protocol handling | 85% | Complex logic |
| CLI/UI | 60% | User-facing, harder to test |
| Logging | 40% | Nice to have |

### Measuring Coverage

```bash
# Generate coverage report
npm test -- --coverage

# View HTML report
open coverage/index.html

# Coverage by file
npm test -- --coverage.reporter=text-summary
```

### Coverage Badge

Add to README.md:
```markdown
[![Coverage Status](https://img.shields.io/badge/coverage-85%25-brightgreen)](./coverage)
```

## Mocking Strategies

### Module Mocking

```typescript
import { vi } from 'vitest';

// Mock entire module
vi.mock('./external', () => ({
  externalFunction: vi.fn(() => 'mocked')
}));

// Spy on existing function
const spy = vi.spyOn(module, 'function');
expect(spy).toHaveBeenCalledWith(arg);
```

### WebSocket Mocking

```typescript
class MockWebSocket {
  onopen?: () => void;
  onmessage?: (data: any) => void;
  onclose?: () => void;
  onerror?: (err: Error) => void;

  send(data: any) {
    // Mock sending
  }

  close() {
    if (this.onclose) this.onclose();
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);
```

### HTTP Mocking

```typescript
import { vi } from 'vitest';

vi.mock('undici', () => ({
  fetch: vi.fn((url) => {
    if (url.includes('/cardhosts')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
      });
    }
    return Promise.reject(new Error('Not mocked'));
  })
}));
```

## Debugging Tests

### Debug Mode

```bash
# Run with Node debugger
node --inspect-brk node_modules/vitest/vitest.mjs run

# Then open chrome://inspect in Chrome
```

### Console Output

```typescript
// Will only show on failure or with --reporter=verbose
console.log('Debug info');

// Always shows
process.stdout.write('Always visible\n');
```

### Test Isolation

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Isolated Tests', () => {
  let testResource: any;

  beforeEach(() => {
    // Setup before each test
    testResource = setupFixture();
  });

  afterEach(() => {
    // Cleanup after each test
    testResource?.cleanup();
  });

  it('should work independently', () => {
    expect(testResource).toBeDefined();
  });
});
```

## Performance Testing

### Benchmarking

```typescript
it('should encrypt message in < 1ms', async () => {
  const start = performance.now();
  
  for (let i = 0; i < 1000; i++) {
    encryptAesGcm(plaintext, key);
  }
  
  const elapsed = performance.now() - start;
  expect(elapsed / 1000).toBeLessThan(1);
});
```

### Memory Testing

```typescript
it('should not leak memory', () => {
  const initialMemory = process.memoryUsage().heapUsed;
  
  // Do work
  for (let i = 0; i < 10000; i++) {
    generateIv();
  }
  
  const finalMemory = process.memoryUsage().heapUsed;
  const increase = (finalMemory - initialMemory) / 1024 / 1024;
  
  expect(increase).toBeLessThan(50); // Less than 50MB
});
```

## Continuous Integration

### GitHub Actions

Tests run automatically on:
- Pull requests
- Commits to main/develop
- Manual trigger

### Local Pre-commit

```bash
# Setup git hooks
npm run prepare

# Hooks will run:
# - npm run lint
# - npm run typecheck
# - npm run test
```

## Troubleshooting

### Common Issues

**Issue**: Tests timeout
```bash
# Increase timeout
npm test -- --test-timeout=10000
```

**Issue**: Module not found
```bash
# Rebuild TypeScript
npm run build
```

**Issue**: Flaky tests
```bash
# Run specific test multiple times
for i in {1..10}; do npm test -- specific.test.ts; done
```

## Best Practices Summary

### General

- ✅ Test behavior, not implementation
- ✅ Use clear, descriptive names
- ✅ Keep tests focused and independent
- ✅ Test edge cases and error conditions
- ✅ Maintain test/code ratio around 1:1

### Unit Tests

- ✅ Fast execution (< 1s for all)
- ✅ No external dependencies
- ✅ Deterministic results
- ✅ High coverage (80%+)

### Integration Tests

- ✅ Test component interactions
- ✅ Use real implementations
- ✅ Reasonable timeouts
- ✅ Clean up resources

### E2E Tests

- ✅ Test user flows
- ✅ Validate business logic
- ✅ Include error scenarios
- ✅ Clear success criteria

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [OWASP Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
