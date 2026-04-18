#!/bin/bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
exec "$dir/deploy-production.sh" "$@"
