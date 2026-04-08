#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
python3 -m pip install -U setuptools wheel
exec python3 -m pip install -e "$root"
