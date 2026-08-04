#!/usr/bin/env bash
# Runs opencode CLI directly from source code without global installation or binary compilation.
# Perfect for live debugging, code edits, and testing options.
#
# Usage examples:
#   ./dev.sh run "Hello agent"
#   ./dev.sh --print-logs --log-level DEBUG run "Test prompt"
#   ./dev.sh agent list
#   ./dev.sh mcp list

bun run --cwd packages/opencode --conditions=browser src/index.ts "$@"
