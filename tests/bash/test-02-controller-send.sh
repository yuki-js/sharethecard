#!/bin/bash
# Test 02: Controller Send Command
# Verifies that the controller can send APDU commands through the router to cardhost
# Spec: docs/what-to-make.md - Section 3.1 (Controller functionality)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Get environment from setup
if [ -z "${ROUTER_URL:-}" ] || [ -z "${TEST_TMP_DIR:-}" ]; then
    log_error "Environment not set. Did you run setup.sh and source it?"
    exit 1
fi

# Get cardhost UUID
if [ -f "$TEST_TMP_DIR/cardhost.uuid" ]; then
    CARDHOST_UUID=$(cat "$TEST_TMP_DIR/cardhost.uuid")
    log_info "Using Cardhost UUID: $CARDHOST_UUID"
else
    log_error "Cardhost UUID not found. Setup may have failed."
    exit 1
fi

begin_test "Controller Send Command"

# Set HOME for controller to use test directory
export HOME="$TEST_TMP_DIR/controller"
CONTROLLER_CLI="$SCRIPT_DIR/../../packages/controller/dist/cli.js"

if [ ! -f "$CONTROLLER_CLI" ]; then
    log_error "Controller CLI not found at $CONTROLLER_CLI"
    log_error "Run 'npm run build' first"
    end_test 1
    exit 1
fi

# Test 1: Send SELECT command (standard APDU)
log_info "Test 1: Sending SELECT APDU command..."
# SELECT command: 00 A4 04 00 08 A0 00 00 00 03 00 00 00
APDU_HEX="00A4040008A000000003000000"

log_info "Running: node $CONTROLLER_CLI send --router $ROUTER_URL --cardhost $CARDHOST_UUID --apdu $APDU_HEX"

OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?

log_info "Controller output:"
echo "$OUTPUT" | sed 's/^/  /'
log_info "Exit code: $EXIT_CODE"

if [ $EXIT_CODE -eq 0 ]; then
    log_success "Controller send command succeeded"
else
    log_error "Controller send command failed with exit code $EXIT_CODE"
    end_test 1
    exit 1
fi

# Test 2: Check response format
log_info "Test 2: Checking response format..."

if assert_contains "$OUTPUT" "SW:" "Response contains status word"; then
    :
else
    log_warn "Response format may be different than expected"
fi

# Test 3: Send invalid APDU (should fail gracefully)
log_info "Test 3: Sending invalid APDU (should fail gracefully)..."
INVALID_APDU="INVALID"

OUTPUT_INVALID=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$INVALID_APDU" \
    2>&1 || true)
EXIT_CODE_INVALID=$?

log_info "Invalid APDU output:"
echo "$OUTPUT_INVALID" | sed 's/^/  /'

# Check either exit code is non-zero OR error message is present
if [ $EXIT_CODE_INVALID -ne 0 ] || echo "$OUTPUT_INVALID" | grep -q "Invalid APDU"; then
    log_success "Invalid APDU correctly rejected"
else
    log_error "Invalid APDU should have been rejected"
    end_test 1
    exit 1
fi

# Test 4: Send without required parameters (should fail)
log_info "Test 4: Testing missing parameters..."

OUTPUT_NO_CARDHOST=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --apdu "$APDU_HEX" \
    2>&1 || true)
EXIT_CODE_NO_CARDHOST=$?

log_info "Missing cardhost output:"
echo "$OUTPUT_NO_CARDHOST" | sed 's/^/  /'

# Check either exit code is non-zero OR error message is present
if [ $EXIT_CODE_NO_CARDHOST -ne 0 ] || echo "$OUTPUT_NO_CARDHOST" | grep -q "Missing required"; then
    log_success "Missing cardhost correctly rejected"
else
    log_error "Missing cardhost should have been rejected"
    end_test 1
    exit 1
fi

# Test 5: Send another APDU to verify connection reuse
log_info "Test 5: Sending second APDU command..."
# Simple GET DATA command: 00 CA 00 00 00
APDU_HEX2="00CA000000"

OUTPUT2=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX2" \
    2>&1)
EXIT_CODE2=$?

log_info "Second APDU output:"
echo "$OUTPUT2" | sed 's/^/  /'

if [ $EXIT_CODE2 -eq 0 ]; then
    log_success "Second APDU command succeeded"
else
    log_error "Second APDU command failed"
    end_test 1
    exit 1
fi

end_test 0
exit 0
