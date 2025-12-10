#!/bin/bash
# Setup script for bash integration tests
# Starts router and cardhost in background
# Spec: docs/what-to-make.md - Section 3.5 (Components as libraries with runtime wrappers)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Configuration
export ROUTER_PORT="${ROUTER_PORT:-13000}"
export ROUTER_URL="http://localhost:${ROUTER_PORT}"
export TEST_TMP_DIR="/tmp/sharethecard-test-$$"

log_info "========================================="
log_info "BASH TEST SETUP"
log_info "========================================="

# Create temporary directories
log_info "Creating temporary directories..."
mkdir -p "$TEST_TMP_DIR"
mkdir -p "$TEST_TMP_DIR/controller"
mkdir -p "$TEST_TMP_DIR/cardhost"

# Set environment variables for components
export HOME_CONTROLLER="$TEST_TMP_DIR/controller"
export HOME_CARDHOST="$TEST_TMP_DIR/cardhost"

log_info "Test directories:"
log_info "  TMP:        $TEST_TMP_DIR"
log_info "  Controller: $HOME_CONTROLLER"
log_info "  Cardhost:   $HOME_CARDHOST"

# Build if needed (should be built already)
if [ ! -d "$SCRIPT_DIR/../../packages/router/dist" ]; then
    log_info "Building packages..."
    (cd "$SCRIPT_DIR/../.." && npm run build)
fi

# Start Router
log_info "Starting Router on port $ROUTER_PORT..."
PORT=$ROUTER_PORT node "$SCRIPT_DIR/../../packages/router/dist/server.js" \
    > "$TEST_TMP_DIR/router.log" 2>&1 &
ROUTER_PID=$!
echo $ROUTER_PID > "$TEST_TMP_DIR/router.pid"
log_info "Router PID: $ROUTER_PID"

# Wait for router to be ready
sleep 2
if ! wait_for_http "$ROUTER_URL/health" 15; then
    log_error "Router failed to start"
    cat "$TEST_TMP_DIR/router.log"
    exit 1
fi

# Verify router is running
HEALTH=$(http_get "$ROUTER_URL/health")
if echo "$HEALTH" | grep -q '"ok":true'; then
    log_success "Router is healthy"
else
    log_error "Router health check failed: $HEALTH"
    exit 1
fi

# Start Cardhost with mock platform
log_info "Starting Cardhost with mock platform..."
ROUTER_URL=$ROUTER_URL \
HOME=$HOME_CARDHOST \
node "$SCRIPT_DIR/../../packages/cardhost/dist/runtime/main.js" \
    --mock \
    > "$TEST_TMP_DIR/cardhost.log" 2>&1 &
CARDHOST_PID=$!
echo $CARDHOST_PID > "$TEST_TMP_DIR/cardhost.pid"
log_info "Cardhost PID: $CARDHOST_PID"

# Wait for cardhost to connect
sleep 3

# Extract cardhost UUID from logs
if [ -f "$TEST_TMP_DIR/cardhost.log" ]; then
    CARDHOST_UUID=$(grep "Cardhost UUID:" "$TEST_TMP_DIR/cardhost.log" | tail -1 | sed -E 's/.*Cardhost UUID: ([^ ]+).*/\1/')
    if [ -n "$CARDHOST_UUID" ]; then
        echo "$CARDHOST_UUID" > "$TEST_TMP_DIR/cardhost.uuid"
        log_success "Cardhost UUID: $CARDHOST_UUID"
    else
        log_warn "Could not extract Cardhost UUID from logs"
        log_info "Cardhost log:"
        cat "$TEST_TMP_DIR/cardhost.log"
    fi
else
    log_error "Cardhost log file not found"
fi

# Verify cardhost is connected by checking router stats
sleep 1
STATS=$(http_get "$ROUTER_URL/stats")
log_info "Router stats: $STATS"

log_success "========================================="
log_success "SETUP COMPLETE"
log_success "========================================="
log_info "Environment variables:"
log_info "  ROUTER_URL:  $ROUTER_URL"
log_info "  ROUTER_PORT: $ROUTER_PORT"
log_info "  TEST_TMP_DIR: $TEST_TMP_DIR"
if [ -n "${CARDHOST_UUID:-}" ]; then
    log_info "  CARDHOST_UUID: $CARDHOST_UUID"
fi
log_info ""
log_info "Processes:"
log_info "  Router:   PID $ROUTER_PID"
log_info "  Cardhost: PID $CARDHOST_PID"
log_info ""
log_info "Logs (use 'cat' or 'tail -f' to view):"
log_info "  Router:   $TEST_TMP_DIR/router.log"
log_info "  Cardhost: $TEST_TMP_DIR/cardhost.log"
log_info ""
log_info "Ready for tests!"
