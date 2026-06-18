#!/bin/bash
cd "$(dirname "$0")/packages/cli" && bun run build --single --skip-install
