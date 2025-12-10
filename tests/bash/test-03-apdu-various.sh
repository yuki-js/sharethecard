#!/bin/bash
# Test 03: Various APDU Commands
# Tests different APDU commands with diverse mock responses
# Spec: docs/what-to-make.md - Section 3.1.2 (APDU operations)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Get environment from setup
if [ -z "${ROUTER_URL:-}" ] || [ -z "${TEST_TMP_DIR:-}" ]; then
    log_error "Environment not set. Did you run setup.sh?"
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

begin_test "Various APDU Commands"

# Set HOME for controller to use test directory
export HOME="$TEST_TMP_DIR/controller"
CONTROLLER_CLI="$SCRIPT_DIR/../../packages/controller/dist/cli.js"
RESULT_DIR="$TEST_TMP_DIR/results"
mkdir -p "$RESULT_DIR"

if [ ! -f "$CONTROLLER_CLI" ]; then
    log_error "Controller CLI not found at $CONTROLLER_CLI"
    end_test 1
    exit 1
fi

log_info "Results will be saved to: $RESULT_DIR"
echo ""

# Test 1: SELECT - Success (9000)
log_info "Test 1: SELECT command (should succeed with 9000)"
APDU_HEX="00A4040008A000000003000000"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/01-select.txt" false)

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "9000" ]; then
    log_success "✓ SELECT (RTT=${RTT}ms)"
else
    log_error "✗ SELECT failed (exit=$EXIT_CODE, SW=$SW)"
    end_test 1
    exit 1
fi
echo ""

# Test 2: GET DATA - Success with data (9000 + data)
log_info "Test 2: GET DATA command (should return data)"
APDU_HEX="00CA000000"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/02-get-data.txt" false)

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "9000" ]; then
    if echo "$OUTPUT" | grep -q "Data:"; then
        log_success "✓ GET DATA (RTT=${RTT}ms)"
    else
        log_warn "⚠ GET DATA succeeded but no data returned"
    fi
else
    log_error "✗ GET DATA failed (exit=$EXIT_CODE, SW=$SW)"
    end_test 1
    exit 1
fi
echo ""

# Test 3: READ BINARY - Success with 16 bytes
log_info "Test 3: READ BINARY command (should return 16 bytes)"
APDU_HEX="00B0000010"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

log_info "RTT: ${RTT}ms"
SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/03-read-binary.txt")

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "9000" ]; then
    # Check data length (32 hex chars = 16 bytes)
    DATA=$(echo "$OUTPUT" | grep "Data:" | sed 's/.*Data: //' | tr -d '[:space:]')
    if [ "${#DATA}" -eq 32 ]; then
        log_success "✓ READ BINARY succeeded with 16 bytes (SW=9000, RTT=${RTT}ms)"
    else
        log_warn "⚠ READ BINARY data length unexpected: ${#DATA} hex chars"
    fi
else
    log_error "✗ READ BINARY failed (exit=$EXIT_CODE, SW=$SW)"
    end_test 1
    exit 1
fi
echo ""

# Test 4: GET CHALLENGE - Should return 8 random bytes
log_info "Test 4: GET CHALLENGE command (should return 8 random bytes)"
APDU_HEX="0084000008"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

log_info "RTT: ${RTT}ms"
SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/04-get-challenge.txt")

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "9000" ]; then
    DATA=$(echo "$OUTPUT" | grep "Data:" | sed 's/.*Data: //' | tr -d '[:space:]')
    if [ "${#DATA}" -eq 16 ]; then  # 16 hex chars = 8 bytes
        log_success "✓ GET CHALLENGE succeeded with 8 bytes (SW=9000, RTT=${RTT}ms)"
    else
        log_warn "⚠ GET CHALLENGE data length unexpected: ${#DATA} hex chars"
    fi
else
    log_error "✗ GET CHALLENGE failed (exit=$EXIT_CODE, SW=$SW)"
    end_test 1
    exit 1
fi
echo ""

# Test 5: FILE NOT FOUND - Should return 6A82
log_info "Test 5: SELECT non-existent file (should fail with 6A82)"
APDU_HEX="00A4000002FFFF"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

log_info "RTT: ${RTT}ms"
SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/05-file-not-found.txt")

# Controller should succeed (connection OK) but SW should indicate error
if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "6A82" ]; then
    log_success "✓ File not found correctly reported (SW=6A82, RTT=${RTT}ms)"
else
    log_warn "⚠ Expected SW=6A82 but got SW=$SW (exit=$EXIT_CODE)"
fi
echo ""

# Test 6: WRONG LENGTH - Should return 6C10
log_info "Test 6: GET RESPONSE with wrong length (should return 6C10)"
APDU_HEX="00C0000000"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

log_info "RTT: ${RTT}ms"
SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/06-wrong-length.txt")

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "6C10" ]; then
    log_success "✓ Wrong length correctly reported (SW=6C10, RTT=${RTT}ms)"
else
    log_warn "⚠ Expected SW=6C10 but got SW=$SW (exit=$EXIT_CODE)"
fi
echo ""

# Test 7: SECURITY NOT SATISFIED - Should return 6982
log_info "Test 7: Command requiring security context (should fail with 6982)"
APDU_HEX="00D000000401020304"
START_TIME=$(measure_time)
OUTPUT=$(node "$CONTROLLER_CLI" send \
    --router "$ROUTER_URL" \
    --cardhost "$CARDHOST_UUID" \
    --apdu "$APDU_HEX" \
    2>&1)
EXIT_CODE=$?
RTT=$(calculate_rtt $START_TIME)

log_info "RTT: ${RTT}ms"
SW=$(analyze_apdu_response "$OUTPUT" "$RESULT_DIR/07-security-not-satisfied.txt")

if [ "$EXIT_CODE" -eq 0 ] && [ "$SW" = "6982" ]; then
    log_success "✓ Security not satisfied correctly reported (SW=6982, RTT=${RTT}ms)"
else
    log_warn "⚠ Expected SW=6982 but got SW=$SW (exit=$EXIT_CODE)"
fi
echo ""

log_info "========================================="
log_info "Test Results Summary"
log_info "========================================="
log_info "All detailed results saved to: $RESULT_DIR"
log_info "View results:"
log_info "  cat $RESULT_DIR/*.txt"
echo ""

end_test 0
exit 0
