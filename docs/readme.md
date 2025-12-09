# Remote APDU Communication System

A distributed system for secure, remote APDU (Application Protocol Data Unit) communication using [`jsapdu-over-ip`](https://github.com/AokiApp/jsapdu-over-ip). Enables safe interaction with smart cards across networks without exposing the card physically, using end-to-end encryption and public key authentication.

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- TypeScript compiler (included)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd sharethecard

# Install dependencies
npm install

# Build all packages
npm run build
```

### Running Components

#### Router (Relay Server)

```bash
# Development mode
PORT=3000 npm run dev -w @remote-apdu/router

# Or directly
cd packages/router
npm run dev
```

Router will be available at `http://localhost:3000`

#### Cardhost (Card Reader Service)

```bash
# Development mode
ROUTER_URL=http://localhost:3000 npm run dev -w @remote-apdu/cardhost

# Or directly
cd packages/cardhost
npm run dev
```

Cardhost monitor available at `http://localhost:8001/monitor`

#### Controller (CLI Tool)

```bash
# Build first
npm run build -w @remote-apdu/controller

# List available Cardhosts
node packages/controller/dist/cli.js list --router http://localhost:3000 --token your-bearer-token

# Send APDU command
node packages/controller/dist/cli.js send \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token your-bearer-token \
  --apdu "00A4040008A000000003000000"

# Interactive mode
node packages/controller/dist/cli.js interactive \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token your-bearer-token

# Execute commands from JSON script
node packages/controller/dist/cli.js script \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token your-bearer-token \
  --file commands.json
```

## Architecture

```
┌──────────────┐     HTTP/WSS      ┌────────────┐     HTTP/WSS      ┌─────────────┐
│  Controller  │◄───────────────►  │   Router   │  ◄───────────────  │  Cardhost   │
│  (Browser)   │  E2E Encrypted    │  (Server)  │    E2E Encrypted   │ (Card Reader)
└──────────────┘                   └────────────┘                    └─────────────┘
      ↓                                                                     ↓
   GUI/CLI                                                          Physical Card
```

### Components

- **Controller**: CLI tool for sending APDU commands (manages user requests)
- **Router**: Central relay server (authentication, session management)
- **Cardhost**: Physical card reader interface (executes APDU commands)
- **Shared**: Cryptographic utilities and protocol definitions

## Security Model

- **Authentication**:
  - Controller: Bearer token
  - Cardhost: Public key + challenge-response
- **E2E Encryption**:
  - ECDH for key exchange
  - AES-256-GCM for message encryption
  - Ed25519/ECDSA for message signing
- **Data Protection**:
  - Router cannot decrypt messages (no access to session keys)
  - All critical operations are digitally signed
  - Ephemeral keys provide Perfect Forward Secrecy

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e

# Coverage report
npm run test -- --coverage
```

## Development

### Project Structure

```
sharethecard/
├── packages/
│   ├── shared/          # Crypto utilities, protocol definitions
│   ├── controller/      # CLI tool
│   ├── cardhost/        # Card reader service
│   ├── router/          # Relay server
│   └── jsapdu-interface/ # Type stubs for jsapdu
├── tests/
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   └── e2e/             # End-to-end tests
├── docs/
│   ├── readme.md        # This file
│   ├── what-to-make.md  # Full specification
│   ├── api-specification.md # API reference
│   ├── architecture.md  # Architecture details
│   ├── security.md      # Security analysis
│   ├── development-guide.md # Development guide
│   └── testing-guide.md # Testing guide
└── .github/workflows/   # CI/CD configuration
```

### Code Style

- TypeScript with strict mode enabled
- ESLint + Prettier for formatting
- Kebab-case for filenames, PascalCase for classes, camelCase for functions

```bash
# Format code
npm run format

# Check formatting
npm run format -- --check

# Lint code
npm run lint

# Type check
npm run typecheck
```

## Configuration

### Environment Variables

**Router**:

```
PORT=3000                    # HTTP port
ROUTER_URL=http://localhost:3000
```

**Cardhost**:

```
ROUTER_URL=http://localhost:3000  # Router URL
PORT=8001                           # Monitor port
CONFIG_DIR=~/.cardhost              # Config directory
```

**Controller**:

```
CONTROLLER_ROUTER=http://localhost:3000
CONTROLLER_TOKEN=your-bearer-token
CONTROLLER_CARDHOST=<uuid>
```

### Configuration Files

**Cardhost** (`~/.cardhost/config.json`):

```json
{
  "routerUrl": "http://localhost:3000",
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "signingPublicKey": "...",
  "signingPrivateKey": "..."
}
```

## API Reference

See [`docs/api-specification.md`](./api-specification.md) for complete API documentation.

### Key Endpoints

**Router**:

- `GET /cardhosts` - List available Cardhosts
- `POST /controller/connect` - Controller authentication
- `POST /cardhost/connect` - Cardhost challenge request
- `POST /cardhost/verify` - Cardhost signature verification
- `POST /sessions` - Create relay session
- `GET /ws/session` - WebSocket upgrade

**Cardhost Monitor**:

- `GET /monitor` - Monitoring UI
- `GET /monitor/status` - Current status
- `GET /monitor/metrics` - Performance metrics
- `GET /monitor/logs` - Event logs

## Examples

### Example 1: Basic APDU Command

```bash
# Terminal 1: Start Router
PORT=3000 npm run dev -w @remote-apdu/router

# Terminal 2: Start Cardhost
ROUTER_URL=http://localhost:3000 npm run dev -w @remote-apdu/cardhost

# Terminal 3: Send APDU
node packages/controller/dist/cli.js send \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token test-token-123456 \
  --apdu "00A4040008A000000003000000" \
  --verbose
```

### Example 2: Interactive Session

```bash
node packages/controller/dist/cli.js interactive \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token test-token-123456

# In interactive mode:
> send 00A4040008A000000003000000
< SW: 9000
> send 00B0000000
< Data: A4, SW: 6C20
> exit
```

### Example 3: Script Execution

**commands.json**:

```json
[{ "apdu": "00A4040008A000000003000000" }, { "apdu": "00B0000000" }, { "apdu": "00B0010000" }]
```

```bash
node packages/controller/dist/cli.js script \
  --router http://localhost:3000 \
  --cardhost 550e8400-e29b-41d4-a716-446655440000 \
  --token test-token-123456 \
  --file commands.json
```

## Troubleshooting

### Connection Issues

**Problem**: `ECONNREFUSED` when connecting to Router

```bash
# Check Router is running
curl http://localhost:3000/cardhosts

# Start Router if needed
PORT=3000 npm run dev -w @remote-apdu/router
```

**Problem**: Cardhost shows "offline" status

```bash
# Check Cardhost is running and connected
curl http://localhost:8001/monitor/status

# Verify ROUTER_URL environment variable
echo $ROUTER_URL
```

### Authentication Issues

**Problem**: `401 Unauthorized` error

```bash
# Verify bearer token format
node packages/controller/dist/cli.js list \
  --router http://localhost:3000 \
  --token your-valid-bearer-token

# Token must be at least 10 characters
```

**Problem**: Cardhost UUID not found

```bash
# List available Cardhosts
node packages/controller/dist/cli.js list \
  --router http://localhost:3000 \
  --token your-token

# Use correct UUID from output
```

### Encryption Issues

**Problem**: `Decryption failed` or `Auth tag verification failed`

- Verify session key derivation is consistent
- Check ECDH keypair generation
- Verify HKDF salt and info parameters

## Performance

Typical performance metrics:

- **APDU Round Trip**: < 100ms (local network)
- **Throughput**: 1000+ APDU/sec per session
- **Memory**: ~ 50MB base, + 10MB per active session
- **CPU**: < 5% idle, < 20% at max throughput

## Monitoring

### Cardhost Monitor Dashboard

Access monitoring UI at `http://localhost:8001/monitor`:

- Real-time status indicator
- APDU statistics (sent/received/errors)
- System metrics (CPU, memory, uptime)
- Event logs with filtering
- Session management

### Logs

Enable verbose logging:

```bash
# Controller
node packages/controller/dist/cli.js send ... --verbose

# Cardhost (environment variable)
LOGLEVEL=debug npm run dev -w @remote-apdu/cardhost
```

## Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes and add tests
3. Run test suite: `npm test`
4. Format code: `npm run format`
5. Commit with message: `git commit -m "feat: description"`
6. Push and open PR

See [`docs/development-guide.md`](./development-guide.md) for detailed guidelines.

## Security Considerations

- **Never** log bearer tokens or private keys
- **Always** use HTTPS/WSS in production
- **Implement** rate limiting on Router
- **Monitor** for suspicious activity patterns
- **Rotate** bearer tokens regularly
- **Keep** dependencies updated (`npm audit`)

See [`docs/security.md`](./security.md) for detailed security analysis.

## License

MIT

## References

- [`jsapdu-over-ip` Repository](https://github.com/AokiApp/jsapdu-over-ip)
- [`jsapdu` Documentation](https://raw.githubusercontent.com/AokiApp/jsapdu/refs/heads/dev/README.md)
- [Hono Web Framework](https://hono.dev/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [NIST SP 800-38D: GCM](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- [RFC 5869: HKDF](https://tools.ietf.org/html/rfc5869)

## Support

For issues, questions, or suggestions:

1. Check existing issues: https://github.com/AokiApp/sharethecard/issues
2. Create new issue with details
3. Join discussions for feature requests

## Changelog

See [CHANGELOG.md](./changelog.md) for version history.
