#!/bin/bash
# Master test runner for bash integration tests
# Runs setup, all tests, and teardown
# Spec: docs/what-to-make.md - Section 6 (Test Strategy)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Track results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

log_info "========================================="
log_info "BASH INTEGRATION TEST SUITE"
log_info "========================================="
log_info "Goal: Verify system compliance with docs/what-to-make.md"
log_info "Method: Direct invocation of components via bash/curl"
log_info ""

# Setup
log_info "Running setup..."
if bash "$SCRIPT_DIR/setup.sh"; then
    log_success "Setup completed"
    
    # Export environment variables from setup for tests
    export ROUTER_PORT="${ROUTER_PORT:-13000}"
    export ROUTER_URL="http://localhost:${ROUTER_PORT}"
    
    # Find test tmp dir
    export TEST_TMP_DIR=$(ls -dt /tmp/sharethecard-test-* 2>/dev/null | head -1)
    
    if [ -z "$TEST_TMP_DIR" ]; then
        log_error "Could not find test directory after setup"
        exit 1
    fi
    
    log_info "Test environment:"
    log_info "  ROUTER_URL: $ROUTER_URL"
    log_info "  TEST_TMP_DIR: $TEST_TMP_DIR"
    
    if [ -f "$TEST_TMP_DIR/cardhost.uuid" ]; then
        export CARDHOST_UUID=$(cat "$TEST_TMP_DIR/cardhost.uuid")
        log_info "  CARDHOST_UUID: $CARDHOST_UUID"
    fi
else
    log_error "Setup failed"
    exit 1
fi

echo ""
log_info "========================================="
log_info "RUNNING TESTS"
log_info "========================================="
echo ""

# Find all test scripts
TEST_SCRIPTS=$(find "$SCRIPT_DIR" -name "test-*.sh" | sort)

if [ -z "$TEST_SCRIPTS" ]; then
    log_error "No test scripts found"
    bash "$SCRIPT_DIR/teardown.sh"
    exit 1
fi

# Run each test
for TEST_SCRIPT in $TEST_SCRIPTS; do
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    TEST_NAME=$(basename "$TEST_SCRIPT")
    
    log_info "Running $TEST_NAME..."
    
    if bash "$TEST_SCRIPT"; then
        log_success "✓ $TEST_NAME PASSED"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        log_error "✗ $TEST_NAME FAILED"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        
        # Show relevant logs on failure
        log_error "Logs available at:"
        log_error "  Router:   $TEST_TMP_DIR/router.log"
        log_error "  Cardhost: $TEST_TMP_DIR/cardhost.log"
        
        if [ "${VERBOSE:-0}" = "1" ]; then
            if [ -f "$TEST_TMP_DIR/router.log" ]; then
                log_info "Recent router log:"
                tail -20 "$TEST_TMP_DIR/router.log" | sed 's/^/    /'
            fi
            
            if [ -f "$TEST_TMP_DIR/cardhost.log" ]; then
                log_info "Recent cardhost log:"
                tail -20 "$TEST_TMP_DIR/cardhost.log" | sed 's/^/    /'
            fi
        fi
    fi
    echo ""
done

# Teardown (quiet)
bash "$SCRIPT_DIR/teardown.sh" >/dev/null 2>&1

log_info "========================================="
log_info "TEST RESULTS"
log_info "========================================="
log_info "Total:  $TOTAL_TESTS"
log_success "Passed: $PASSED_TESTS"
if [ $FAILED_TESTS -gt 0 ]; then
    log_error "Failed: $FAILED_TESTS"
else
    log_info "Failed: $FAILED_TESTS"
fi
log_info "========================================="

# Exit with appropriate code
if [ $FAILED_TESTS -eq 0 ]; then
    log_success "ALL TESTS PASSED ✓"
    echo ""
    log_info "Compliance verification: The system demonstrates"
    log_info "functionality described in docs/what-to-make.md through"
    log_info "actual invocation of controller, router, and cardhost."
    exit 0
else
    log_error "SOME TESTS FAILED ✗"
    echo ""
    log_error "Issues found during compliance verification."
    log_error "Review test output and logs for details."
    exit 1
fi
