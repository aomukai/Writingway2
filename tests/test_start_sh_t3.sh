#!/bin/bash
# Tests for start.sh port-env refactoring (T3)
# Verifies: .env sourcing, variable substitution, default behavior, set -a exports
#
# Usage: bash tests/test_start_sh_t3.sh

set -euo pipefail

PASS=0
FAIL=0
SCRIPT_PATH="$(cd "$(dirname "$0")/.." && pwd)/start.sh"

pass_test() {
    echo "  PASS: $1"
    PASS=$((PASS + 1))
}

fail_test() {
    echo "  FAIL: $1 — $2"
    FAIL=$((FAIL + 1))
}

# Check that a plain text string appears in the file (fixed string match)
check_in() {
    if grep -qF "$2" "$1" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Check that a regex pattern appears in the file
check_regex() {
    if grep -qE "$2" "$1" 2>/dev/null; then
        return 0
    fi
    return 1
}

echo ""
echo "====================================="
echo "  Tests for start.sh (T3)"
echo "====================================="
echo ""

# ── Test Group 1: .env sourcing ──
echo "[1] .env file sourcing"
check_in "$SCRIPT_PATH" 'if [ -f ".env" ]' && \
    pass_test ".env existence check" || \
    fail_test ".env existence check" "pattern 'if [ -f \".env\" ]' not found"

check_in "$SCRIPT_PATH" 'set -a; . ./.env; set +a' && \
    pass_test "set -a/.env/set +a block" || \
    fail_test "set -a/.env/set +a block" "pattern not found"

check_in "$SCRIPT_PATH" '[*] Loaded .env' && \
    pass_test "Echo message after .env is loaded" || \
    fail_test "Echo message after .env is loaded" "pattern not found"

check_in "$SCRIPT_PATH" 'APP_PORT="${WRITINGWAY_PORT:-8000}"' && \
    pass_test "APP_PORT variable defined with default 8000" || \
    fail_test "APP_PORT variable defined with default 8000" "pattern not found"

check_in "$SCRIPT_PATH" 'UPDATER_PORT="${WRITINGWAY_UPDATER_PORT:-8001}"' && \
    pass_test "UPDATER_PORT variable defined with default 8001" || \
    fail_test "UPDATER_PORT variable defined with default 8001" "pattern not found"

check_in "$SCRIPT_PATH" 'AI_PORT="${WRITINGWAY_AI_PORT:-8080}"' && \
    pass_test "AI_PORT variable defined with default 8080" || \
    fail_test "AI_PORT variable defined with default 8080" "pattern not found"

# Verify .env sourcing happens AFTER Python check block
PYTHON_LINE=$(grep -n 'echo "\[OK\] Python 3 found"' "$SCRIPT_PATH" | head -1 | cut -d: -f1)
ENV_LINE=$(grep -n 'if \[ -f ".env" \]' "$SCRIPT_PATH" | head -1 | cut -d: -f1)
[ "$ENV_LINE" -gt "$PYTHON_LINE" ] && \
    pass_test ".env sourcing after Python check (line $ENV_LINE > $PYTHON_LINE)" || \
    fail_test ".env sourcing placement" "line $ENV_LINE <= $PYTHON_LINE"

# ── Test Group 2: Hardcoded ports replaced ──
echo ""
echo "[2] Hardcoded ports replaced with variables"

# Use grep to find the actual llama-server command (starts with ./llama/)
LLAMA_CMD=$(grep '^\s*./llama/llama-server' "$SCRIPT_PATH" | head -1)
if [ -z "$LLAMA_CMD" ]; then
    # Fallback: look for line with both llama-server and --port
    LLAMA_CMD=$(grep 'llama-server.*--port' "$SCRIPT_PATH" | head -1)
fi
echo "$LLAMA_CMD" | grep -qF -- '--port "$AI_PORT"' && \
    pass_test "llama-server uses \$AI_PORT" || \
    fail_test "llama-server uses \$AI_PORT" "line: $LLAMA_CMD"

# AI health check — extract the curl line for AI health
AI_HEALTH_LINE=$(grep 'health' "$SCRIPT_PATH" | grep 'curl' | head -1)
echo "$AI_HEALTH_LINE" | grep -qF -- '$AI_PORT/health' && \
    pass_test "AI health check uses \$AI_PORT" || \
    fail_test "AI health check uses \$AI_PORT" "line: $AI_HEALTH_LINE"

check_in "$SCRIPT_PATH" 'AI server starting on port $AI_PORT' && \
    pass_test "AI echo message uses \$AI_PORT" || \
    fail_test "AI echo message uses \$AI_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'Updater service started on port $UPDATER_PORT' && \
    pass_test "Updater echo uses \$UPDATER_PORT" || \
    fail_test "Updater echo uses \$UPDATER_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'Starting app server on port $APP_PORT' && \
    pass_test "App server echo uses \$APP_PORT" || \
    fail_test "App server echo uses \$APP_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'http://localhost:$APP_PORT/main.html' && \
    pass_test "URL status messages use \$APP_PORT" || \
    fail_test "URL status messages use \$APP_PORT" "pattern not found"

APP_HEALTH_LINE=$(grep 'api/health' "$SCRIPT_PATH" | grep 'curl' | head -1)
echo "$APP_HEALTH_LINE" | grep -qF -- '$APP_PORT/api/health' && \
    pass_test "App health check uses \$APP_PORT" || \
    fail_test "App health check uses \$APP_PORT" "line: $APP_HEALTH_LINE"

check_in "$SCRIPT_PATH" 'open "http://localhost:$APP_PORT/main.html"' && \
    pass_test "macOS open uses \$APP_PORT" || \
    fail_test "macOS open uses \$APP_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'xdg-open "http://localhost:$APP_PORT/main.html"' && \
    pass_test "Linux xdg-open uses \$APP_PORT" || \
    fail_test "Linux xdg-open uses \$APP_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'AI API: http://localhost:$AI_PORT' && \
    pass_test "AI API status message uses \$AI_PORT" || \
    fail_test "AI API status message uses \$AI_PORT" "pattern not found"

check_in "$SCRIPT_PATH" 'Updater: http://localhost:$UPDATER_PORT' && \
    pass_test "Updater status message uses \$UPDATER_PORT" || \
    fail_test "Updater status message uses \$UPDATER_PORT" "pattern not found"

# Verify NO remaining hardcoded ports in messages/urls (excluding variable definition lines 35-37)
REST=$(sed '35,37d' "$SCRIPT_PATH")
echo "$REST" | grep -qE '(curl|http)[^0-9]*8080' 2>/dev/null && \
    fail_test "No hardcoded 8080 in messages" "found in rest of file" || \
    pass_test "No hardcoded 8080 in messages"

echo "$REST" | grep -qE '(curl|http)[^0-9]*8000' 2>/dev/null && \
    fail_test "No hardcoded 8000 in messages" "found in rest of file" || \
    pass_test "No hardcoded 8000 in messages"

echo "$REST" | grep -qE '(curl|http)[^0-9]*8001' 2>/dev/null && \
    fail_test "No hardcoded 8001 in messages" "found in rest of file" || \
    pass_test "No hardcoded 8001 in messages"

# ── Test Group 3: Default behavior unchanged ──
echo ""
echo "[3] Default behavior (no .env) produces same output"
check_in "$SCRIPT_PATH" 'WRITINGWAY_PORT:-8000' && \
    pass_test "Default APP_PORT is 8000" || \
    fail_test "Default APP_PORT is 8000" "pattern not found"

check_in "$SCRIPT_PATH" 'WRITINGWAY_UPDATER_PORT:-8001' && \
    pass_test "Default UPDATER_PORT is 8001" || \
    fail_test "Default UPDATER_PORT is 8001" "pattern not found"

check_in "$SCRIPT_PATH" 'WRITINGWAY_AI_PORT:-8080' && \
    pass_test "Default AI_PORT is 8080" || \
    fail_test "Default AI_PORT is 8080" "pattern not found"

# ── Test Group 4: Syntax validation ──
echo ""
echo "[4] Syntax validation"
if bash -n "$SCRIPT_PATH" 2>/dev/null; then
    pass_test "start.sh passes bash -n syntax check"
else
    fail_test "start.sh syntax" "bash -n reported errors"
fi

# ── Test Group 5: .env sourcing and variable resolution ──
echo ""
echo "[5] .env sourcing and variable resolution"
TMPDIR=$(mktemp -d)
cp "$SCRIPT_PATH" "$TMPDIR/start_test.sh"

env_content="WRITINGWAY_PORT=9900
WRITINGWAY_UPDATER_PORT=9901
WRITINGWAY_AI_PORT=9980"
printf '%s\n' "$env_content" > "$TMPDIR/.env"

RESULT=$( bash -c "
    cd '$TMPDIR'
    if [ -f '.env' ]; then
        set -a; . ./.env; set +a
    fi
    APP_PORT=\"\${WRITINGWAY_PORT:-8000}\"
    UPDATER_PORT=\"\${WRITINGWAY_UPDATER_PORT:-8001}\"
    AI_PORT=\"\${WRITINGWAY_AI_PORT:-8080}\"
    echo \"APP_PORT=\$APP_PORT UPDATER_PORT=\$UPDATER_PORT AI_PORT=\$AI_PORT\"
" 2>&1 )

echo "$RESULT" | grep -qF 'APP_PORT=9900 UPDATER_PORT=9901 AI_PORT=9980' && \
    pass_test "Custom .env ports resolved correctly" || \
    fail_test "Custom .env ports" "got: $RESULT"

# Test with no .env → defaults
RESULT2=$( bash -c "
    cd '$TMPDIR'
    rm -f .env
    if [ -f '.env' ]; then
        set -a; . ./.env; set +a
    fi
    APP_PORT=\"\${WRITINGWAY_PORT:-8000}\"
    UPDATER_PORT=\"\${WRITINGWAY_UPDATER_PORT:-8001}\"
    AI_PORT=\"\${WRITINGWAY_AI_PORT:-8080}\"
    echo \"APP_PORT=\$APP_PORT UPDATER_PORT=\$UPDATER_PORT AI_PORT=\$AI_PORT\"
" 2>&1 )

echo "$RESULT2" | grep -qF 'APP_PORT=8000 UPDATER_PORT=8001 AI_PORT=8080' && \
    pass_test "Default ports without .env" || \
    fail_test "Default ports without .env" "got: $RESULT2"

# Test set -a exports — child processes should inherit
RESULT3=$( bash -c "
    cd '$TMPDIR'
    printf 'MYVAR=hello\n' > .env
    set -a; . ./.env; set +a
    # Subshell should inherit MYVAR from exported variable
    bash -c 'echo CHILD_VALUE=\$MYVAR'
" 2>&1 )

echo "$RESULT3" | grep -qF 'CHILD_VALUE=hello' && \
    pass_test "set -a exports to child processes" || \
    fail_test "set -a exports" "got: $RESULT3"

# Cleanup
rm -rf "$TMPDIR"

# ── Summary ──
echo ""
echo "====================================="
TOTAL=$((PASS + FAIL))
echo "  Results: $PASS passed, $FAIL failed (out of $TOTAL)"
echo "====================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
