# Bash Integration Tests (打鍵テスト)

Direct invocation testing for the Remote APDU Communication System.

## Overview

This test suite verifies system functionality by **directly invoking** compiled components (router, cardhost, controller) rather than using vitest. This approach provides confidence that the system works in real-world scenarios.

### Test Philosophy

As stated in [`docs/what-to-make.md`](../../docs/what-to-make.md) Section 6:

> テストを通すことが目的ではない。テストを通して（※通して(とおして)ではない）目標を満たしているかを確認することが重要だ。

These tests verify compliance through actual invocation and observation, not just passing test assertions.

## Quick Start

```bash
# Run all tests (includes setup and teardown)
bash tests/bash/run-all-tests.sh

# Run individual test
bash tests/bash/test-01-router-health.sh

# Manual control
bash tests/bash/setup.sh      # Start router & cardhost
# ... run tests manually ...
bash tests/bash/teardown.sh   # Stop & cleanup
```

## Test Structure

```
tests/bash/
├── README.md              # This file
├── TEST-REPORT.md         # Detailed test report
├── helpers/
│   └── common.sh          # Shared utilities, logging, assertions
├── setup.sh               # Start router & cardhost in background
├── teardown.sh            # Stop processes & cleanup
├── test-01-router-health.sh       # Router HTTP endpoints
├── test-02-controller-send.sh     # Controller CLI APDU commands
└── run-all-tests.sh       # Master test runner
```

### One Test Per File

Each test scenario is in its own file:
- Easier to run individually
- Clear test boundaries
- Independent execution
- Follows "one test, one file" principle from task requirements

### Setup/Teardown Separation

- `setup.sh`: Starts router and cardhost, exports environment variables
- `teardown.sh`: Stops processes, shows logs, cleans up temp files
- Tests assume setup has been run (either via `run-all-tests.sh` or manually)

## Test Cases

### Test 01: Router Health Check

**File**: `test-01-router-health.sh`

Verifies router HTTP management endpoints:
- `/health` returns `{"ok":true,"running":true}`
- `/stats` returns system statistics
- Invalid paths return 404

### Test 02: Controller Send Command

**File**: `test-02-controller-send.sh`

Verifies controller CLI functionality:
- Send valid APDU and receive response
- Reject invalid APDU gracefully
- Reject missing required parameters
- Reuse keypair on subsequent invocations

## Test Environment

### Processes Started by Setup

1. **Router** - Port 13000 (configurable via `ROUTER_PORT`)
   ```bash
   node packages/router/dist/server.js
   ```

2. **Cardhost** - Mock platform (no PC/SC hardware)
   ```bash
   node packages/cardhost/dist/runtime/main.js --mock
   ```

### Temporary Directories

Each test run creates:
```
/tmp/sharethecard-test-<PID>/
├── controller/           # Controller HOME directory
├── cardhost/             # Cardhost HOME directory
├── router.log            # Router process log
├── router.pid            # Router process ID
├── cardhost.log          # Cardhost process log
├── cardhost.pid          # Cardhost process ID
└── cardhost.uuid         # Extracted cardhost UUID
```

### Environment Variables

Setup exports:
- `ROUTER_URL` - Router base URL (default: http://localhost:13000)
- `ROUTER_PORT` - Router port (default: 13000)
- `TEST_TMP_DIR` - Temporary directory path
- `CARDHOST_UUID` - Connected cardhost UUID

## Writing New Tests

### Template

```bash
#!/bin/bash
# Test XX: Test Name
# Brief description of what this test verifies
# Spec: docs/what-to-make.md - Section X.X

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Check environment
if [ -z "${ROUTER_URL:-}" ] || [ -z "${TEST_TMP_DIR:-}" ]; then
    log_error "Environment not set. Did you run setup.sh?"
    exit 1
fi

begin_test "Test Name"

# Test Case 1
log_info "Test Case 1: Description..."
# ... test logic ...
if assert_eq "expected" "actual" "Description"; then
    :
else
    end_test 1
    exit 1
fi

# Test Case 2
log_info "Test Case 2: Description..."
# ... test logic ...

end_test 0
exit 0
```

### Helper Functions

Available from `common.sh`:

**Logging:**
- `log_info "message"` - Blue info message
- `log_success "message"` - Green success message
- `log_error "message"` - Red error message
- `log_warn "message"` - Yellow warning message

**Assertions:**
- `assert_eq "expected" "actual" "message"` - Assert equality
- `assert_contains "haystack" "needle" "message"` - Assert substring
- `assert_exit_code "expected" "actual" "message"` - Assert exit code

**HTTP/WebSocket:**
- `http_get "url" [timeout]` - GET request with curl
- `http_post "url" "data" [timeout]` - POST request with curl
- `wait_for_port "port" [timeout]` - Wait for TCP port
- `wait_for_http "url" [timeout]` - Wait for HTTP endpoint

**Test Framework:**
- `begin_test "name"` - Start test, print banner
- `end_test [status]` - End test, print result

## Test Output

### Successful Test

```
[INFO] =========================================
[INFO] TEST: Router Health Check
[INFO] =========================================
[INFO] Testing /health endpoint...
[OK] Health endpoint returned success
[INFO] Response: {"ok":true,"running":true}
[OK] ✓ Health response contains ok:true
[OK] ✓ Health response contains running field
[OK] TEST PASSED: Router Health Check
```

### Failed Test

```
[INFO] =========================================
[INFO] TEST: Some Test
[INFO] =========================================
[INFO] Test 1: Description...
[ERROR] ✗ Expected 'foo' but got 'bar'
  Expected: foo
  Actual:   bar
[ERROR] TEST FAILED: Some Test
```

### Full Suite Results

```
[INFO] =========================================
[INFO] TEST RESULTS
[INFO] =========================================
[INFO] Total:  2
[OK] Passed: 2
[INFO] Failed: 0
[INFO] =========================================
[OK] ALL TESTS PASSED ✓

[INFO] Compliance verification: The system demonstrates
[INFO] functionality described in docs/what-to-make.md through
[INFO] actual invocation of controller, router, and cardhost.
```

## Debugging

### View Logs

Logs are preserved in `TEST_TMP_DIR` until teardown:

```bash
# Find most recent test directory
TEST_DIR=$(ls -dt /tmp/sharethecard-test-* | head -1)

# View router log
cat $TEST_DIR/router.log

# View cardhost log
cat $TEST_DIR/cardhost.log

# View cardhost UUID
cat $TEST_DIR/cardhost.uuid
```

### Run Setup Without Teardown

```bash
# Start components
bash tests/bash/setup.sh

# Test environment is now available
# Run tests manually, inspect processes, etc.

# When done
bash tests/bash/teardown.sh
```

### Check Running Processes

```bash
# Find test directory
TEST_DIR=$(ls -dt /tmp/sharethecard-test-* | head -1)

# Check router
ROUTER_PID=$(cat $TEST_DIR/router.pid)
ps aux | grep $ROUTER_PID

# Check cardhost
CARDHOST_PID=$(cat $TEST_DIR/cardhost.pid)
ps aux | grep $CARDHOST_PID
```

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Build packages
  run: npm run build

- name: Run Bash Integration Tests
  run: bash tests/bash/run-all-tests.sh
```

## Troubleshooting

### Port Already in Use

If you see `EADDRINUSE` errors, kill existing processes:

```bash
lsof -ti :13000 | xargs kill -9
```

Or change the port:

```bash
ROUTER_PORT=13001 bash tests/bash/run-all-tests.sh
```

### Cardhost Fails to Start

Check the cardhost log:

```bash
cat /tmp/sharethecard-test-*/cardhost.log
```

Common issues:
- PC/SC library loading (should be fixed with `--mock` flag)
- Config directory permissions
- Network connectivity to router

### Tests Hang

Tests have timeouts on HTTP requests (5s default). If hanging:
- Check router is actually running: `curl http://localhost:13000/health`
- Check cardhost connected: `curl http://localhost:13000/stats`
- View process logs for errors

## Design Rationale

### Why Bash Instead of Vitest?

From the task requirements:

> bashとcurlを使って、vitestを使わずにテストを実装してほしい。
> E2Eよりもよりうえの「打鍵テスト」である。

Bash tests provide:
- **Real invocation**: Tests actual compiled binaries, not library imports
- **Process isolation**: Each component runs in separate process
- **Observable behavior**: Logs show actual authentication flows, APDU transmission
- **CI/CD friendly**: Easy to run in any environment with bash
- **Specification verification**: Tests through actual usage, not mocks

### Why One Test Per File?

From the task requirements:

> 一テスト1ファイル。beforeEach/afterEach相当の処理もファイルに分けろ。

Benefits:
- **Clarity**: Each test file has single responsibility
- **Independence**: Tests can run in any order
- **Debugging**: Easy to isolate failing test
- **Maintenance**: Changes to one test don't affect others
- **Execution**: Can run individual tests during development

## Related Documentation

- [`TEST-REPORT.md`](TEST-REPORT.md) - Detailed test results and findings
- [`docs/what-to-make.md`](../../docs/what-to-make.md) - Project specification
- [`docs/testing-guide.md`](../../docs/testing-guide.md) - General testing strategy

---

**Created**: 2025-12-10  
**Purpose**: 打鍵テスト (Direct invocation testing)  
**Status**: ✅ All tests passing
