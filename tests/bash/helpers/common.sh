#!/bin/bash
# Common utilities for bash integration tests
# Spec: docs/what-to-make.md - Testing through actual invocation

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test state
TEST_NAME=""
TEST_PASSED=0
TEST_FAILED=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*" >&2
}

# Test assertions
assert_eq() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Expected '$expected' but got '$actual'}"
    
    if [ "$expected" = "$actual" ]; then
        log_success "✓ $message"
        return 0
    else
        log_error "✗ $message"
        log_error "  Expected: $expected"
        log_error "  Actual:   $actual"
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-Expected to contain '$needle'}"
    
    if echo "$haystack" | grep -q "$needle"; then
        log_success "✓ $message"
        return 0
    else
        log_error "✗ $message"
        log_error "  Haystack: $haystack"
        log_error "  Needle:   $needle"
        return 1
    fi
}

assert_exit_code() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Expected exit code $expected but got $actual}"
    
    if [ "$expected" -eq "$actual" ]; then
        log_success "✓ Exit code $actual"
        return 0
    else
        log_error "✗ $message"
        return 1
    fi
}

# HTTP/WebSocket utilities
http_get() {
    local url="$1"
    local timeout="${2:-5}"
    curl -s -f -m "$timeout" "$url" 2>/dev/null || true
}

http_post() {
    local url="$1"
    local data="$2"
    local timeout="${3:-5}"
    curl -s -f -m "$timeout" -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null || true
}

wait_for_port() {
    local port="$1"
    local timeout="${2:-10}"
    local elapsed=0
    
    log_info "Waiting for port $port to be ready..."
    while ! nc -z localhost "$port" 2>/dev/null; do
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for port $port"
            return 1
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    log_success "Port $port is ready"
    return 0
}

wait_for_http() {
    local url="$1"
    local timeout="${2:-10}"
    local elapsed=0
    
    log_info "Waiting for HTTP endpoint $url..."
    while ! http_get "$url" >/dev/null 2>&1; do
        if [ $elapsed -ge $timeout ]; then
            log_error "Timeout waiting for $url"
            return 1
        fi
        sleep 0.5
        elapsed=$((elapsed + 1))
    done
    log_success "HTTP endpoint $url is ready"
    return 0
}

# Process management
start_background_process() {
    local name="$1"
    shift
    local cmd="$@"
    
    log_info "Starting $name: $cmd"
    $cmd &
    local pid=$!
    echo $pid > "/tmp/${name}.pid"
    log_info "$name started with PID $pid"
    return 0
}

stop_background_process() {
    local name="$1"
    local pid_file="/tmp/${name}.pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            log_info "Stopping $name (PID $pid)"
            kill "$pid" 2>/dev/null || true
            sleep 0.5
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$pid_file"
    fi
}

# Cleanup trap
cleanup_on_exit() {
    log_info "Cleaning up background processes..."
}

trap cleanup_on_exit EXIT

# Timing utilities
measure_time() {
    date +%s%3N
}

calculate_rtt() {
    local start_ms="$1"
    local end_ms=$(date +%s%3N)
    echo $((end_ms - start_ms))
}

# APDU response analysis
analyze_apdu_response() {
    local output="$1"
    local result_file="${2:-}"
    local verbose="${3:-false}"
    
    # Extract SW (Status Word)
    local sw=$(echo "$output" | grep "SW:" | sed 's/.*SW: //' | tr -d '[:space:]')
    
    # Extract Data if present
    local data=$(echo "$output" | grep "Data:" | sed 's/.*Data: //' | tr -d '[:space:]')
    
    local analysis=""
    analysis+="Status Word: ${sw:-N/A}\n"
    analysis+="Data Length: ${#data} hex chars ($(( ${#data} / 2 )) bytes)\n"
    if [ -n "$data" ]; then
        analysis+="Data: $data\n"
    fi
    analysis+="\n"
    
    # Decode SW
    local status_symbol=""
    local status_text=""
    case "$sw" in
        "9000")
            status_symbol="✓"
            status_text="SUCCESS"
            analysis+="Status: ✓ SUCCESS (0x9000)\n"
            ;;
        "6100"|61*)
            status_symbol="✓"
            status_text="SUCCESS with ${sw:2:2} bytes available"
            analysis+="Status: ✓ SUCCESS with ${sw:2:2} bytes available\n"
            ;;
        "6C"*)
            status_symbol="⚠"
            status_text="WRONG LENGTH (correct: 0x${sw:2:2})"
            analysis+="Status: ⚠ WRONG LENGTH (correct: 0x${sw:2:2})\n"
            ;;
        "6A82")
            status_symbol="✗"
            status_text="FILE NOT FOUND"
            analysis+="Status: ✗ FILE NOT FOUND (0x6A82)\n"
            ;;
        "6982")
            status_symbol="✗"
            status_text="SECURITY NOT SATISFIED"
            analysis+="Status: ✗ SECURITY NOT SATISFIED (0x6982)\n"
            ;;
        "63C"*)
            status_symbol="⚠"
            status_text="VERIFICATION FAILED (${sw:3:1} retries left)"
            analysis+="Status: ⚠ VERIFICATION FAILED (${sw:3:1} retries left)\n"
            ;;
        "6700")
            status_symbol="✗"
            status_text="WRONG LENGTH"
            analysis+="Status: ✗ WRONG LENGTH (0x6700)\n"
            ;;
        *)
            status_symbol="?"
            status_text="OTHER (0x$sw)"
            analysis+="Status: ? OTHER (0x$sw)\n"
            ;;
    esac
    
    # Write to file if specified
    if [ -n "$result_file" ]; then
        echo -e "$analysis" > "$result_file"
    fi
    
    # Only echo to stderr if verbose
    if [ "$verbose" = "true" ]; then
        echo -e "$analysis" >&2
    else
        # Just show one-line summary
        log_info "$status_symbol SW=$sw $([ -n "$data" ] && echo "(${#data}/2 bytes)" || echo "(no data)")"
    fi
    
    # Return SW for caller
    echo "$sw"
}

# Show process logs
show_process_log() {
    local log_file="$1"
    local lines="${2:-20}"
    local label="${3:-Log}"
    
    if [ -f "$log_file" ]; then
        log_info "$label (last $lines lines):"
        log_info "---"
        tail -"$lines" "$log_file" | sed 's/^/  /' >&2
        log_info "---"
    else
        log_warn "$label file not found: $log_file"
    fi
}

# Test framework
begin_test() {
    TEST_NAME="$1"
    log_info "========================================="
    log_info "TEST: $TEST_NAME"
    log_info "========================================="
}

end_test() {
    local status="${1:-0}"
    if [ "$status" -eq 0 ]; then
        log_success "TEST PASSED: $TEST_NAME"
        TEST_PASSED=$((TEST_PASSED + 1))
    else
        log_error "TEST FAILED: $TEST_NAME"
        TEST_FAILED=$((TEST_FAILED + 1))
    fi
    echo ""
}

# Export functions
export -f log_info log_success log_error log_warn
export -f assert_eq assert_contains assert_exit_code
export -f http_get http_post wait_for_port wait_for_http
export -f start_background_process stop_background_process
export -f measure_time calculate_rtt analyze_apdu_response show_process_log
export -f begin_test end_test
