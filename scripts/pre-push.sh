#!/bin/bash
# Pre-push validation script
# Run this before pushing to ensure CI will pass

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Pre-Push Validation${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to run a check
run_check() {
    local name="$1"
    local command="$2"
    
    echo -e "${YELLOW}➜${NC} Running ${name}..."
    
    if eval "$command"; then
        echo -e "${GREEN}✓${NC} ${name} passed"
        echo ""
        return 0
    else
        echo -e "${RED}✗${NC} ${name} failed"
        echo ""
        return 1
    fi
}

# Track failures
FAILED=0

# Type checking
run_check "Type checking" "npm run typecheck" || FAILED=$((FAILED + 1))

# Linting
run_check "Linting" "npm run lint" || FAILED=$((FAILED + 1))

# Format check
run_check "Format check" "npm run format -- --check" || FAILED=$((FAILED + 1))

# Build
run_check "Build" "npm run build" || FAILED=$((FAILED + 1))

# Unit tests
run_check "Unit tests" "npm run test:unit" || FAILED=$((FAILED + 1))

# Integration tests
run_check "Integration tests" "npm run test:integration" || FAILED=$((FAILED + 1))

# E2E tests
run_check "E2E tests" "npm run test:e2e" || FAILED=$((FAILED + 1))

# Bash tests
run_check "Bash integration tests" "npm run test:bash" || FAILED=$((FAILED + 1))

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo -e "${GREEN}Ready to push 🚀${NC}"
    exit 0
else
    echo -e "${RED}✗ $FAILED check(s) failed${NC}"
    echo ""
    echo -e "${RED}Please fix the issues before pushing${NC}"
    exit 1
fi
