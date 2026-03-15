#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$PWD}"

if [ ! -d "${TARGET_DIR}" ]; then
  echo "target dir is missing: ${TARGET_DIR}" >&2
  exit 1
fi

RUNNER="$(mktemp -t securecode-warp)"

cat > "${RUNNER}" <<EOF
#!/bin/zsh
exec "${SCRIPT_DIR}/run-securecode.sh" "${TARGET_DIR}"
EOF

chmod +x "${RUNNER}"
open -na Warp "${RUNNER}"
