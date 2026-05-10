#!/usr/bin/env bash
# Run test coverage across all three testable layers and print a summary.
#
# Layers:
#   - frontend  (apps/web)                — vitest  → apps/web/coverage
#   - convex    (packages/convex-backend) — vitest  → packages/convex-backend/coverage
#   - fastapi   (packages/fastapi)        — pytest  → packages/fastapi/htmlcov
#
# Usage:
#   scripts/coverage-report.sh [frontend|convex|fastapi|all]   # default: all
#
# Each layer echoes the exact command it runs before running it, so the output
# doubles as documentation for how to reproduce locally.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"

COLOR_BLUE="\033[1;34m"
COLOR_GREEN="\033[1;32m"
COLOR_RED="\033[1;31m"
COLOR_GRAY="\033[0;90m"
COLOR_RESET="\033[0m"

RESULTS=()  # each entry: "name|status|summary"

section() {
    printf "\n${COLOR_BLUE}━━━ %s ━━━${COLOR_RESET}\n" "$1"
}

echo_cmd() {
    printf "${COLOR_GRAY}\$ %s${COLOR_RESET}\n" "$*"
}

record() {
    RESULTS+=("$1|$2|$3")
}

_vitest_summary() {
    local path="$1"
    [[ -f "$path" ]] || { printf "(no summary at %s)" "$path"; return; }
    node -e "
      const s = require('$path').total;
      const f = k => s[k].pct.toFixed(2) + '%';
      console.log(\`lines \${f('lines')} · branches \${f('branches')} · funcs \${f('functions')} · stmts \${f('statements')}\`);
    " 2>/dev/null || printf "(parse failed)"
}

_pytest_summary() {
    local path="$1"
    [[ -f "$path" ]] || { printf "(no coverage.xml)"; return; }
    local rate branch
    rate=$(grep -Eo 'line-rate="[0-9.]+"' "$path" | head -1 | grep -Eo '[0-9.]+')
    branch=$(grep -Eo 'branch-rate="[0-9.]+"' "$path" | head -1 | grep -Eo '[0-9.]+')
    if [[ -z "$rate" ]]; then
        printf "(parse failed)"
        return
    fi
    local pct
    pct=$(awk "BEGIN { printf \"%.2f\", $rate * 100 }")
    if [[ -n "$branch" && "$branch" != "0" ]]; then
        local bpct
        bpct=$(awk "BEGIN { printf \"%.2f\", $branch * 100 }")
        printf "lines %s%% · branches %s%%" "$pct" "$bpct"
    else
        printf "lines %s%%" "$pct"
    fi
}

run_frontend() {
    section "Frontend (apps/web) — vitest + v8 coverage"
    local dir="$ROOT/apps/web"
    echo_cmd "cd apps/web && bun run test:coverage"
    if ( cd "$dir" && bun run test:coverage ); then
        record "frontend" "PASS" "$(_vitest_summary "$dir/coverage/coverage-summary.json")"
    else
        record "frontend" "FAIL" "vitest exited non-zero"
    fi
}

run_convex() {
    section "Convex (packages/convex-backend) — vitest + v8 coverage"
    local dir="$ROOT/packages/convex-backend"
    echo_cmd "cd packages/convex-backend && bun run test:coverage"
    if ( cd "$dir" && bun run test:coverage ); then
        record "convex" "PASS" "$(_vitest_summary "$dir/coverage/coverage-summary.json")"
    else
        record "convex" "FAIL" "vitest exited non-zero"
    fi
}

run_fastapi() {
    section "FastAPI (packages/fastapi) — pytest + coverage.py"
    local dir="$ROOT/packages/fastapi"
    local py
    if [[ -x "$dir/.venv/bin/pytest" ]]; then
        py="$dir/.venv/bin/pytest"
    elif command -v pytest >/dev/null 2>&1; then
        py="pytest"
    else
        record "fastapi" "FAIL" "pytest not found — run: python -m venv packages/fastapi/.venv && packages/fastapi/.venv/bin/pip install -r packages/fastapi/requirements-dev.txt"
        return 1
    fi
    echo_cmd "cd packages/fastapi && $py --cov --cov-report=term --cov-report=html --cov-report=xml"
    if ( cd "$dir" && "$py" --cov --cov-report=term --cov-report=html --cov-report=xml ); then
        record "fastapi" "PASS" "$(_pytest_summary "$dir/coverage.xml")"
    else
        record "fastapi" "FAIL" "pytest exited non-zero"
    fi
}

case "$TARGET" in
    frontend) run_frontend ;;
    convex)   run_convex ;;
    fastapi)  run_fastapi ;;
    all)
        run_frontend
        run_convex
        run_fastapi
        ;;
    *)
        printf "unknown target: %s\n" "$TARGET" >&2
        printf "usage: %s [frontend|convex|fastapi|all]\n" "$0" >&2
        exit 2
        ;;
esac

section "Summary"
printf "%-10s %-6s %s\n" "layer" "status" "coverage"
printf "%-10s %-6s %s\n" "----------" "------" "--------"
overall_ok=0
for row in "${RESULTS[@]}"; do
    IFS='|' read -r name status summary <<<"$row"
    if [[ "$status" == "PASS" ]]; then
        color="$COLOR_GREEN"
    else
        color="$COLOR_RED"
        overall_ok=1
    fi
    printf "${color}%-10s %-6s${COLOR_RESET} %s\n" "$name" "$status" "$summary"
done

exit "$overall_ok"
