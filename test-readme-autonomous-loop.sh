#!/usr/bin/env bash
# Test: README must contain Autonomous Loop documentation

README="/Users/os/conductor/workspaces/pi-mono-v4/hangzhou-v1/README.md"

# Check for Autonomous Loop section heading
if ! grep -q "## Autonomous Loop" "$README"; then
    echo "FAIL: README missing '## Autonomous Loop' section"
    exit 1
fi

# Check for workflow phases mention
if ! grep -q "workflow" "$README"; then
    echo "FAIL: README missing workflow documentation"
    exit 1
fi

# Check for phase states
if ! grep -q "prd_loaded\|tdd_red\|tdd_green\|review_1" "$README"; then
    echo "FAIL: README missing phase state documentation"
    exit 1
fi

# Check for commands
if ! grep -q "/workflow" "$README"; then
    echo "FAIL: README missing workflow commands"
    exit 1
fi

echo "PASS: README contains Autonomous Loop documentation"
exit 0
