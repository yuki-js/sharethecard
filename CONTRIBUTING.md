# Contributing Guide

Thank you for your interest in contributing to the Remote APDU Communication System!

## Getting Started

### Prerequisites

- Node.js 18.x or 20.x
- npm (comes with Node.js)
- Bash shell (for bash tests)
- curl (for bash tests)

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/yuki-js/sharethecard.git
cd sharethecard

# Install dependencies
npm ci

# Build all packages
npm run build
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

Edit the code in the appropriate package:

- `packages/controller/` - Controller CLI
- `packages/cardhost/` - Cardhost Service
- `packages/router/` - Router Server
- `packages/shared/` - Shared utilities

### 3. Run Tests

```bash
# Run all checks (recommended before committing)
npm run validate

# Or run individually:
npm run typecheck    # Type checking
npm run lint         # Code linting
npm run format       # Code formatting (auto-fix with --write)
npm run build        # Build all packages
npm test             # Run vitest tests
npm run test:bash    # Run bash tests
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: your feature description"
# or
git commit -m "fix: your bug fix description"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Testing

### Test Types

1. **Unit Tests** - Test individual functions
   ```bash
   npm run test:unit
   ```

2. **Integration Tests** - Test component interactions
   ```bash
   npm run test:integration
   ```

3. **E2E Tests** - Test full system with real network
   ```bash
   npm run test:e2e
   ```

4. **Bash Tests** - Test real process execution
   ```bash
   npm run test:bash
   ```

### Writing Tests

- Place unit tests in `tests/unit/` or `packages/*/tests/unit/`
- Place integration tests in `tests/integration/` or `packages/*/tests/integration/`
- Place E2E tests in `tests/e2e/`
- Place bash tests in `tests/bash/`

See [docs/testing-guide.md](docs/testing-guide.md) for detailed testing documentation.

## Code Style

### TypeScript

- Use TypeScript for all source code
- Enable strict type checking
- Follow existing code patterns
- Use meaningful variable and function names

### Formatting

```bash
# Check formatting
npm run format -- --check

# Auto-fix formatting
npm run format
```

### Linting

```bash
# Check linting
npm run lint

# Auto-fix linting (some issues)
npm run lint -- --fix
```

## Project Structure

```
sharethecard/
├── packages/
│   ├── controller/       # Controller CLI
│   ├── cardhost/         # Cardhost Service
│   ├── router/           # Router Server
│   └── shared/           # Shared utilities
├── tests/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   ├── e2e/             # E2E tests
│   └── bash/            # Bash integration tests
├── docs/                 # Documentation
├── scripts/              # Helper scripts
└── .github/
    └── workflows/        # CI/CD workflows
```

## Development Commands

```bash
# Build
npm run build            # Build all packages
npm run clean            # Clean all build outputs

# Testing
npm test                 # Run all vitest tests
npm run test:unit        # Run unit tests
npm run test:integration # Run integration tests
npm run test:e2e         # Run E2E tests
npm run test:bash        # Run bash tests
npm run test:all         # Run all tests

# Code Quality
npm run typecheck        # Type checking
npm run lint             # Lint code
npm run format           # Format code

# Validation
npm run validate         # Run all checks (pre-push)
```

## Package-Specific Development

### Controller

```bash
cd packages/controller
npm run build
npm run dev              # Run in development mode
```

### Cardhost

```bash
cd packages/cardhost
npm run build
npm run dev              # Run with mock platform
```

### Router

```bash
cd packages/router
npm run build
npm run dev              # Run development server
npm start                # Run production server
```

## CI/CD

All pull requests run through CI which includes:

1. Type checking
2. Linting
3. Format check
4. Build verification
5. Unit tests
6. Integration tests
7. E2E tests
8. Bash integration tests
9. Security audit
10. Coverage report

The CI must pass before merging.

## Documentation

- Read [docs/what-to-make.md](docs/what-to-make.md) for specification
- Read [docs/testing-guide.md](docs/testing-guide.md) for testing strategy
- Read [docs/development-guide.md](docs/development-guide.md) for development details
- Update documentation when making user-facing changes

## Getting Help

- Check existing documentation in `docs/`
- Look at existing code for examples
- Open an issue for questions or problems

## Code Review

All contributions require code review before merging:

- Keep changes focused and minimal
- Write clear commit messages
- Update tests for your changes
- Update documentation as needed
- Respond to review feedback

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
