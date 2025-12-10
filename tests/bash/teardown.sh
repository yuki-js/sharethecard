#!/bin/bash
# Teardown script for bash integration tests
# Stops router and cardhost, cleans up temporary files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Get TEST_TMP_DIR from environment or use default pattern
if [ -z "${TEST_TMP_DIR:-}" ]; then
    # Find most recent test directory
    TEST_TMP_DIR=$(ls -dt /tmp/sharethecard-test-* 2>/dev/null | head -1)
fi

if [ -z "$TEST_TMP_DIR" ] || [ ! -d "$TEST_TMP_DIR" ]; then
    log_warn "No test directory found, nothing to clean up"
    exit 0
fi

log_info "========================================="
log_info "BASH TEST TEARDOWN"
log_info "========================================="
log_info "Test directory: $TEST_TMP_DIR"

# Stop Cardhost
if [ -f "$TEST_TMP_DIR/cardhost.pid" ]; then
    CARDHOST_PID=$(cat "$TEST_TMP_DIR/cardhost.pid")
    if kill -0 "$CARDHOST_PID" 2>/dev/null; then
        log_info "Stopping Cardhost (PID $CARDHOST_PID)..."
        kill "$CARDHOST_PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$CARDHOST_PID" 2>/dev/null; then
            log_warn "Cardhost did not stop gracefully, forcing..."
            kill -9 "$CARDHOST_PID" 2>/dev/null || true
        fi
        log_success "Cardhost stopped"
    else
        log_info "Cardhost is not running"
    fi
else
    log_info "Cardhost PID file not found"
fi

# Stop Router
if [ -f "$TEST_TMP_DIR/router.pid" ]; then
    ROUTER_PID=$(cat "$TEST_TMP_DIR/router.pid")
    if kill -0 "$ROUTER_PID" 2>/dev/null; then
        log_info "Stopping Router (PID $ROUTER_PID)..."
        kill "$ROUTER_PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$ROUTER_PID" 2>/dev/null; then
            log_warn "Router did not stop gracefully, forcing..."
            kill -9 "$ROUTER_PID" 2>/dev/null || true
        fi
        log_success "Router stopped"
    else
        log_info "Router is not running"
    fi
else
    log_info "Router PID file not found"
fi

# Logs are available in TEST_TMP_DIR if needed for debugging
# Only show on error or if VERBOSE=1
if [ "${VERBOSE:-0}" = "1" ]; then
    if [ -f "$TEST_TMP_DIR/router.log" ]; then
        log_info "Router log: $TEST_TMP_DIR/router.log"
        tail -10 "$TEST_TMP_DIR/router.log" | sed 's/^/  /'
    fi
    
    if [ -f "$TEST_TMP_DIR/cardhost.log" ]; then
        log_info "Cardhost log: $TEST_TMP_DIR/cardhost.log"
        tail -10 "$TEST_TMP_DIR/cardhost.log" | sed 's/^/  /'
    fi
fi

log_success "Cleanup complete"

log_success "========================================="
log_success "TEARDOWN COMPLETE"
log_success "========================================="
