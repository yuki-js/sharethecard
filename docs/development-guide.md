# Development Guide

Guidelines for contributing to the Remote APDU Communication System.

## Setup

### Prerequisites

- Node.js 18.0+
- npm 9.0+
- Git
- Text editor or IDE (VS Code recommended)

### Initial Setup

```bash
# Clone repository
git clone https://github.com/AokiApp/sharethecard.git
cd sharethecard

# Install dependencies
npm install

# Setup git hooks (optional)
npm run prepare

# Verify setup
npm run typecheck
npm run lint
npm test -- --run
```

## Project Structure

```
sharethecard/
├── packages/
│   ├── controller/       # CLI tool for APDU operations
│   ├── cardhost/         # Card reader service
│   ├── router/           # Relay/routing server
│   ├── shared/           # Shared crypto and protocol utilities
│   └── jsapdu-interface/ # Type definitions for jsapdu
├── tests/
│   ├── unit/             # Unit tests (crypto, auth, utils)
│   ├── integration/      # Component integration tests
│   └── e2e/              # Full system end-to-end tests
├── docs/
│   ├── readme.md         # Main README
│   ├── what-to-make.md   # Project specification
│   ├── api-specification.md
│   ├── architecture.md
│   ├── security.md
│   ├── development-guide.md (this file)
│   └── testing-guide.md
├── .github/
│   └── workflows/        # CI/CD pipelines
├── vitest.config.ts      # Test configuration
├── tsconfig.base.json    # TypeScript base config
├── package.json          # Root package manifest
└── .prettierrc           # Code formatting config
```

## Working with Packages

### Workspace Commands

```bash
# Build all packages
npm run build

# Build specific package
npm run build -w @remote-apdu/controller

# Run tests for specific package
npm run test -w @remote-apdu/shared

# Clean build artifacts
npm run clean -ws
```

### Adding Dependencies

```bash
# Add to root (dev dependencies)
npm install --save-dev <package>

# Add to specific workspace
npm install --save <package> -w @remote-apdu/cardhost
```

## Coding Standards

### TypeScript

- **Strict Mode**: Always enabled (`strict: true`)
- **Target**: ES2020
- **Module**: ESNext

```typescript
// ✅ Good: Explicit types
function deriveKey(secret: Uint8Array, salt: Uint8Array): Uint8Array {
  // implementation
}

// ❌ Bad: Implicit types
function deriveKey(secret, salt) {
  // implementation
}
```

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `crypto-utils.ts` |
| Classes | PascalCase | `CardHostManager` |
| Functions | camelCase | `sendApduCommand()` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Interfaces | PascalCase with `I` prefix (optional) | `IApduCommand` or `ApduCommand` |
| Private members | camelCase with `_` prefix | `_internalState` |

### File Organization

```typescript
// 1. Imports
import type { SomeType } from './types';
import { someUtility } from './utils';

// 2. Type definitions
interface MyInterface {
  prop: string;
}

// 3. Constants
const DEFAULT_TIMEOUT = 5000;

// 4. Main class/function
export class MyClass {
  // properties
  // constructor
  // public methods
  // private methods
}

// 5. Helper functions
function privateHelper(): void {
  // implementation
}

// 6. Exports
export { MyClass };
```

## Testing

### Test Structure

Create tests in `tests/unit/`, `tests/integration/`, or `tests/e2e/`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Feature Name', () => {
  describe('Sub-feature', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';
      
      // Act
      const result = functionUnderTest(input);
      
      // Assert
      expect(result).toBe('expected');
    });

    it('should handle edge case', () => {
      expect(() => functionUnderTest(null)).toThrow();
    });
  });
});
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e

# With coverage
npm test -- --coverage

# Watch mode (development)
npm test -- --watch

# Specific test file
npm test -- crypto-encryption.test.ts

# Specific test suite
npm test -- --grep "ECDH"
```

### Mocking

Use `vi.mock()` for mocking modules:

```typescript
import { vi } from 'vitest';

vi.mock('./external-module', () => ({
  externalFunction: vi.fn(() => 'mocked-result')
}));
```

### Test Coverage

Minimum requirements:
- **Shared modules**: 80%
- **Authentication**: 90%
- **Encryption**: 100%
- **Overall**: 70%

```bash
# Generate coverage report
npm test -- --coverage

# View HTML report
open coverage/index.html
```

## Code Quality

### ESLint

```bash
# Check code
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix

# Check specific file
npm run lint packages/controller/src/cli.ts
```

### Prettier

```bash
# Format all files
npm run format

# Check formatting
npm run format -- --check

# Format specific file
npm run format packages/router/src/index.ts
```

### Type Checking

```bash
# Check types
npm run typecheck

# Watch mode
npm run typecheck -- --watch
```

## Common Tasks

### Adding a New Feature

1. Create feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

2. Implement feature in appropriate package:
   ```bash
   # Edit files in packages/*/src/
   ```

3. Add tests:
   ```bash
   # Add test files in tests/
   ```

4. Verify quality:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   ```

5. Commit and push:
   ```bash
   git add .
   git commit -m "feat: add my feature

   - Detailed description
   - Related issue: #123"
   git push origin feature/my-feature
   ```

6. Create Pull Request on GitHub

### Fixing a Bug

1. Create issue branch:
   ```bash
   git checkout -b fix/issue-description
   ```

2. Write failing test:
   ```typescript
   // Add test that reproduces bug
   it('should handle X correctly', () => {
     expect(buggyFunction()).toEqual(correct);
   });
   ```

3. Fix bug:
   ```bash
   # Edit relevant files
   npm test  # Verify test passes
   ```

4. Submit PR with test included

### Updating Dependencies

```bash
# Check for updates
npm outdated

# Update all packages
npm update

# Update specific package
npm install <package>@latest

# Security audit
npm audit

# Fix vulnerabilities automatically
npm audit fix
```

## Building for Production

```bash
# Clean build
npm run clean
npm run build

# Verify all packages built successfully
ls packages/*/dist/index.js

# Run full test suite
npm test

# Type check
npm run typecheck
```

## Git Workflow

### Branch Naming

- `feature/description` - New features
- `fix/issue-id` - Bug fixes
- `docs/topic` - Documentation
- `refactor/area` - Code refactoring
- `test/feature` - Test additions

### Commit Messages

Follow conventional commits:

```
type(scope): subject

body

footer
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting changes
- `refactor`: Code refactoring
- `test`: Test additions
- `chore`: Build/tooling changes

Example:
```
feat(crypto): add HMAC-based message authentication

Implement HMAC-SHA256 for message authentication as fallback
when digital signatures are not suitable.

Closes #123
```

### Pull Request Process

1. Ensure CI passes
2. Request review from at least 2 maintainers
3. Address feedback
4. Squash commits if needed
5. Merge to main

## Debugging

### VS Code Setup

`.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Router",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev", "-w", "@remote-apdu/router"],
      "cwd": "${workspaceFolder}"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["test", "--run"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### Debug Logging

```typescript
// Conditional logging
const debug = process.env.DEBUG === 'true';

if (debug) {
  console.debug('Debug info:', variable);
}

// Or use environment
DEBUG=true npm run dev -w @remote-apdu/router
```

## Documentation

### Adding Documentation

1. Add markdown file in `docs/`
2. Update index if needed
3. Link from README.md
4. Follow markdown style guide

### Code Comments

```typescript
// ✅ Good: Explains WHY, not WHAT
// Using Ed25519 for deterministic signatures to ensure
// message authenticity across verification attempts
const signature = signJsonEd25519(payload, privateKey);

// ❌ Bad: States the obvious
// Sign the payload
const signature = signJsonEd25519(payload, privateKey);
```

### JSDoc Comments

```typescript
/**
 * Derive a session key from ECDH shared secret.
 *
 * @param sharedSecret - Computed ECDH shared secret (32 bytes)
 * @param salt - Random salt for HKDF (32 bytes)
 * @param info - Context info for HKDF derivation
 * @param length - Desired key length in bytes (default 32)
 * @returns Derived session key
 * @throws Error if inputs are invalid length
 */
export function deriveSessionKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = 32
): Uint8Array {
  // implementation
}
```

## Performance

### Profiling

```bash
# With Node profiler
node --prof packages/router/dist/index.js
node --prof-process isolate-*.log > profile.txt

# With clinic.js
npm install -g clinic
clinic doctor -- node packages/router/dist/index.js
```

### Optimization Tips

- Use `Uint8Array` for binary data (not Buffer in hot paths)
- Reuse objects to reduce GC pressure
- Batch operations when possible
- Use appropriate algorithms for scale

## Troubleshooting

### Build Issues

```bash
# Clean node_modules
rm -rf node_modules
npm install

# Rebuild native modules
npm rebuild

# Clear TypeScript cache
npm run clean
npm run build
```

### Test Issues

```bash
# Run with verbose output
npm test -- --reporter=verbose

# Run single test file
npm test -- crypto-encryption.test.ts

# Run tests matching pattern
npm test -- --grep "encryption"

# Debug test
node --inspect-brk node_modules/vitest/vitest.mjs run
```

### Runtime Issues

```bash
# Enable debug mode
DEBUG=true npm run dev -w @remote-apdu/cardhost

# Verbose logging
LOG_LEVEL=debug npm run dev -w @remote-apdu/router

# Check environment
env | grep -E "ROUTER|CARDHOST|TOKEN"
```

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Commit: `git commit -m "release: v1.0.0"`
4. Tag: `git tag v1.0.0`
5. Push: `git push && git push --tags`
6. GitHub Actions will create release

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)

## Getting Help

1. Check existing documentation in `docs/`
2. Search GitHub issues
3. Ask in discussions or open issue
4. Contact maintainers

## Code of Conduct

- Be respectful and inclusive
- Assume good intent
- Provide constructive feedback
- Report issues to maintainers
