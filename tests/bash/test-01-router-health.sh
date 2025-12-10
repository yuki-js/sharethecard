#!/bin/bash
# Test 01: Router Health Check
# Verifies that the Router is running and responds to health checks
# Spec: docs/what-to-make.md - Section 3.3.3 (Router endpoints)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/common.sh"

# Get environment from setup
if [ -z "${ROUTER_URL:-}" ]; then
    log_error "ROUTER_URL not set. Did you run setup.sh?"
    exit 1
fi

begin_test "Router Health Check"

# Test 1: Health endpoint returns 200
log_info "Testing /health endpoint..."
HEALTH_RESPONSE=$(http_get "$ROUTER_URL/health")
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    log_success "Health endpoint returned success"
else
    log_error "Health endpoint failed with exit code $EXIT_CODE"
    end_test 1
    exit 1
fi

# Test 2: Health response contains expected fields
log_info "Checking health response format..."
log_info "Response: $HEALTH_RESPONSE"

if assert_contains "$HEALTH_RESPONSE" '"ok":true' "Health response contains ok:true"; then
    :
else
    end_test 1
    exit 1
fi

if assert_contains "$HEALTH_RESPONSE" '"running"' "Health response contains running field"; then
    :
else
    end_test 1
    exit 1
fi

# Test 3: Stats endpoint returns data
log_info "Testing /stats endpoint..."
STATS_RESPONSE=$(http_get "$ROUTER_URL/stats")
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    log_success "Stats endpoint returned success"
else
    log_error "Stats endpoint failed with exit code $EXIT_CODE"
    end_test 1
    exit 1
fi

log_info "Stats response: $STATS_RESPONSE"

# Test 4: Invalid path returns 404
log_info "Testing invalid path returns 404..."
INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" "$ROUTER_URL/invalid-path" 2>/dev/null)
HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -1)

if assert_eq "404" "$HTTP_CODE" "Invalid path returns 404"; then
    :
else
    end_test 1
    exit 1
fi

end_test 0
exit 0
