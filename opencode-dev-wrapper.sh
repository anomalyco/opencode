#!/usr/bin/env bash
set -euo pipefail

cd "/var/folders/dy/1gn60jd91d9gvjb9789n7s340000gn/T/opencode/opencode/packages/opencode"
exec bun run --conditions=browser ./src/index.ts "$@"
