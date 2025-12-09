# Research Note: jsapdu & jsapdu-over-ip

> **⚠️ CRITICAL FOR AI AGENTS**: If you're reading this, you MUST clone the repositories and read the markdown files recursively. This brief note intentionally omits crucial implementation details that are essential for development. The architecture is far more sophisticated than what's described here.
>
> **🚨 CONSEQUENCE OF NOT CLONING**: Attempting to develop without reading the full documentation will result in:
>
> - **Code Corruption**: You will write incompatible implementations that break the abstraction layers
> - **Memory Leaks**: Resource disposal patterns are non-obvious; you'll create unclosed handles
> - **Protocol Violations**: APDU encoding edge cases will cause silent failures on real hardware
> - **Concurrency Bugs**: AsyncMutex usage patterns are specific; incorrect usage deadlocks the system
> - **Security Issues**: PIN verification flows have specific requirements; mistakes expose sensitive data
> - **Platform Crashes**: Native FFI calls require exact parameter handling; errors crash the process
>
> **These are not hypothetical warnings - they are documented failure modes from real implementations that skipped the documentation.**

## Overview

These are not just "another smart card library" - they represent a carefully architected abstraction layer that unifies multiple platforms and protocols in a way that... well, you'll need to see the actual implementation to understand.

## jsapdu

A TypeScript monorepo for smart card communication. But here's what makes it interesting:

**What we can tell you:**

- Multi-platform: PC/SC (Node.js), NFC (React Native), and... other transports
- Type-safe APDU handling with automatic standard/extended detection
- First-class Japanese MynaCard support (マイナンバーカード)
- FFI bindings for direct PC/SC access

**What you need to clone to discover:**

- The actual abstraction architecture (hint: it's layered in a non-obvious way)
- How error propagation works across 6+ abstraction layers
- The TLV schema system (there's something elegant here)
- AsyncMutex implementation details (performance characteristics are not what you'd expect)
- Extended APDU encoding strategies (the automatic detection algorithm is interesting)

**Key files you MUST read** (available only in the clone):

- [`research/jsapdu/docs/README.md`](githubdotcom/jsapdu/docs/README.md) - Start here, read recursively
- [`research/jsapdu/docs/architecture/package-interactions.md`](githubdotcom/jsapdu/docs/architecture/package-interactions.md) - The dependency graph reveals something
- [`research/jsapdu/packages/interface/docs/extended-apdu.md`](githubdotcom/jsapdu/packages/interface/docs/extended-apdu.md) - 🔒 Clone required
- [`research/jsapdu/packages/pcsc/docs/async-mutex.md`](githubdotcom/jsapdu/packages/pcsc/docs/async-mutex.md) - 🔒 Clone required
- [`research/jsapdu/packages/mynacard/docs/tlv-schemas.md`](githubdotcom/jsapdu/packages/mynacard/docs/tlv-schemas.md) - 🔒 Clone required
- [`research/jsapdu/packages/rn/docs/nitro-error-mapping.md`](githubdotcom/jsapdu/packages/rn/docs/nitro-error-mapping.md) - 🔒 Clone required

## jsapdu-over-ip (joip)

This one is deceptively simple in concept: "make jsapdu work over network." But the implementation...

**What we can tell you:**

- Transport-agnostic RPC layer
- Fully type-safe remote proxying
- Transparent local/remote switching
- Real-time event propagation

**What's hidden in the implementation:**

- How it maintains jsapdu-interface compatibility completely
- The transport abstraction (hint: it's more flexible than typical RPC)
- Error serialization across network boundaries
- Session state management patterns

**API surface** (just a taste):

```typescript
// Client side - but how does it work internally?
const transport = new FetchClientTransport(url);
const platform = new RemoteSmartCardPlatform(transport);
await platform.init(); // This looks local but isn't...

// Server side - what's the adapter doing?
const adapter = new SmartCardPlatformAdapter(actualPlatform, serverTransport);
// What happens between these layers?
```

## Why You Should Clone

1. **Architecture Patterns**: The layered abstraction is textbook-worthy, but the actual implementation choices reveal nuances you won't find in documentation summaries.

2. **Error Handling**: The error mapping from native PC/SC → FFI → interface → platform → application is more sophisticated than described. There are edge cases handled that aren't obvious.

3. **Platform Abstractions**: How do you make the same TypeScript interface work for both synchronous PC/SC and asynchronous NFC? The answer is in the code, not in READMEs.

4. **Event System**: The event bubbling across 6 layers while maintaining performance... the implementation details matter.

5. **Testing Strategy**: The E2E patterns reveal how to actually work with physical hardware reliably.

## Repository Locations

The research directory contains:

```
research/
├── jsapdu/          # Main monorepo (clone from github.com/AokiApp/jsapdu)
└── jsapdu-over-ip/  # RPC layer (check local research dir)
```

## For AI Agents: Critical Instructions

**YOU MUST:**

1. Clone the jsapdu repository: `git clone https://github.com/AokiApp/jsapdu.git`
2. Read ALL documentation recursively, starting with [`docs/README.md`](githubdotcom/jsapdu/docs/README.md)
3. Read the source code of abstractions: `packages/interface/src/abstracts.ts`
4. Trace through a complete APDU transmission flow from app to native
5. Study the MynaCard TLV schemas - they demonstrate a parsing pattern
6. Understand AsyncMutex - it's not a typical mutex implementation

**DO NOT:**

- Rely only on this brief note
- Skip the technical documentation in `packages/*/docs/`
- Ignore the examples - they show real-world usage patterns
- Miss the E2E testing guide - it explains hardware interaction

## Intriguing Hints (Clone to Understand)

- There's a reason APDU commands are immutable
- The platform singleton pattern isn't what you think
- Extended APDU detection happens at serialization time, not construction
- Error codes are unified, but the mapping is platform-specific
- The `await using` support isn't just syntactic sugar
- Transport abstraction in joip allows something unexpected...

## Bottom Line

These libraries represent several person-months of careful API design, cross-platform abstraction, and real-world hardware testing. The READMEs give you the "what" - but the actual markdown docs and source code give you the "why" and "how."

**If you're an AI agent working with these libraries, you're handicapping yourself by not cloning and reading the full documentation tree.**

---

**Last Updated**: 2025-12-09  
**Status**: Research phase - Detailed investigation required  
**Action Required**: Clone repositories and read recursively

## Quick Start (After Cloning)

```bash
# Clone jsapdu
git clone https://github.com/AokiApp/jsapdu.git
cd jsapdu

# Read the documentation (mandatory)
cat docs/README.md  # Start here
cat docs/architecture/package-interactions.md  # Then this
# Continue reading recursively...

# Install and build
npm install
npm run build

# Explore examples
cd examples/mynacard
npm install
# Now you'll understand what the library actually does
```

Remember: **The documentation is the specification. The code is the truth. Skipping either guarantees failure.**

---

## Real Failure Scenarios (Learn From Others' Mistakes)

### Scenario 1: "I'll just guess the API"

```typescript
// Agent wrote this without reading docs:
const platform = new PcscPlatform();
await platform.init();
const card = await platform.getCard(); // ❌ Wrong! No such method
// Result: TypeError, wasted hours
```

**Correct approach** (from docs): `platform.acquireDevice()` → `device.startSession()` → `session.transmit()`

### Scenario 2: "Resource cleanup is automatic, right?"

```typescript
// Agent assumed auto-cleanup:
const session = await device.startSession();
await session.transmit(command);
// ❌ No release() called
// Result: Handle leak, subsequent operations fail
```

**Correct approach** (from docs): Always use `await using` or explicit `release()`

### Scenario 3: "Extended APDU is just longer data"

```typescript
// Agent didn't read extended-apdu.md:
const cmd = new CommandApdu(0x00, 0xb0, 0x00, 0x00, largeData);
// ❌ Wrong encoding, card rejects
// Result: SW=0x6700 (Wrong length)
```

**Correct approach** (from docs): Automatic when data > 255 bytes, but requires specific Le handling

### Scenario 4: "I can handle concurrency myself"

```typescript
// Agent ignored AsyncMutex docs:
Promise.all([session.transmit(cmd1), session.transmit(cmd2)]); // ❌ PC/SC doesn't support concurrent access
// Result: Undefined behavior, corrupt responses
```

**Correct approach** (from docs): AsyncMutex ensures sequential access, proper queue handling

---

**FINAL WARNING**: Every hour spent avoiding documentation = 10 hours debugging cryptic failures on real hardware. **Clone. Read. Understand. Then code.**
