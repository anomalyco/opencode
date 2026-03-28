#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ASSET_DIR}/../.." && pwd)"
SEC_CODE_BENCH_DIR="${SECURECODE_SEC_CODE_BENCH_DIR:-${SECURECODE_CACHE_ROOT:-${HOME}/.cache/securecode}/sec-code-bench}"
SUITE="${SECURECODE_SUITE:-product-eng-ja}"
CASE_ID="${1:-order-webhook-router}"
SCENARIO="${2:-prompt}"
TARGET_DIR="${3:-${REPO_ROOT}/worktrees/securecode-trial-${CASE_ID}}"
LOCALE="${SECURECODE_LOCALE:-zh-CN}"

usage() {
  echo "usage: $0 [case_id] [gen|gen-hints|fix|fix-hints] [target_dir]" >&2
  exit 1
}

suffix_for_scenario() {
  case "$1" in
    gen) echo "" ;;
    gen-hints) echo "Hints" ;;
    fix) echo "Fix" ;;
    fix-hints) echo "FixHints" ;;
    *) usage ;;
  esac
}

if [ ! -d "${SEC_CODE_BENCH_DIR}" ]; then
  if [ "${SUITE}" = "legacy-securecode" ]; then
    echo "sec-code-bench cache not found: ${SEC_CODE_BENCH_DIR}" >&2
    exit 1
  fi
fi

if [ "${SUITE}" = "product-eng-ja" ]; then
  WORKLOAD_FILE="${ASSET_DIR}/workload/product_eng_ja_workload.json"
  WORKSPACE_DIR="$(python3 - <<'PY' "${WORKLOAD_FILE}" "${CASE_ID}"
import json, sys
from pathlib import Path
rows = json.loads(Path(sys.argv[1]).read_text())
case_id = sys.argv[2]
row = next((item for item in rows if item["id"] == case_id), None)
if row is None:
    raise SystemExit(f"case not found: {case_id}")
print((Path(sys.argv[1]).parent / row["workspace"]).resolve())
PY
)"
  rm -rf "${TARGET_DIR}"
  mkdir -p "${TARGET_DIR}"
  cp -R "${WORKSPACE_DIR}/." "${TARGET_DIR}/"
  python3 - <<'PY' "${WORKLOAD_FILE}" "${CASE_ID}" "${TARGET_DIR}"
import json, sys
from pathlib import Path
rows = json.loads(Path(sys.argv[1]).read_text())
case_id = sys.argv[2]
target = Path(sys.argv[3])
row = next(item for item in rows if item["id"] == case_id)
(target / "PROMPT.ja.md").write_text(row["prompt"])
README = f"""# Product Eng Trial Workspace

suite: product-eng-ja
case_id: {row["id"]}
language: {row["language"]}
mode: {row["mode"]}
target_output: {row["target_output"]}

## Try It

1. Open this directory with your editor or coding assistant
2. Paste the content of `PROMPT.ja.md`
3. Continue with follow-up questions as if you were doing a normal development session
"""
(target / "README.securecode-trial.md").write_text(README)
PY
  echo "${TARGET_DIR}"
  exit 0
fi

TEMPLATE_NAME="$(python3 - <<'PY' "${SEC_CODE_BENCH_DIR}" "${CASE_ID}"
import json, sys
from pathlib import Path
bench = json.loads((Path(sys.argv[1]) / "datasets/benchmark/java/java.json").read_text())
case_id = sys.argv[2]
print(bench[case_id]["template"])
PY
)"

PROMPT_NAME="$(python3 - <<'PY' "${SEC_CODE_BENCH_DIR}" "${CASE_ID}"
import json, sys
from pathlib import Path
bench = json.loads((Path(sys.argv[1]) / "datasets/benchmark/java/java.json").read_text())
case_id = sys.argv[2]
print(bench[case_id]["prompt"])
PY
)"

SUFFIX="$(suffix_for_scenario "${SCENARIO}")"
PROMPT_PATH="${SEC_CODE_BENCH_DIR}/datasets/benchmark/java/prompts/${PROMPT_NAME}${SUFFIX}.${LOCALE}"
TEMPLATE_DIR="${SEC_CODE_BENCH_DIR}/datasets/templates/java/${TEMPLATE_NAME}"

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
cp -R "${TEMPLATE_DIR}/." "${TARGET_DIR}/"
cp "${PROMPT_PATH}" "${TARGET_DIR}/PROMPT.${LOCALE}.md"

cat > "${TARGET_DIR}/README.securecode-trial.md" <<EOF
# SecureCode Trial Workspace

case_id: ${CASE_ID}
scenario: ${SCENARIO}
template: ${TEMPLATE_NAME}
prompt: ${PROMPT_NAME}${SUFFIX}.${LOCALE}

## Try It

1. Open this directory with your editor or coding assistant
2. Paste the content of \`PROMPT.${LOCALE}.md\`
3. Continue with follow-up questions as if you were doing a normal secure coding session

Live load can be started separately with:

\`\`\`bash
cd ${REPO_ROOT}
./benchmarks/securecode/scripts/securecode_session_loadctl.sh start 128 0
\`\`\`

Stop the background load with:

\`\`\`bash
cd ${REPO_ROOT}
./benchmarks/securecode/scripts/securecode_session_loadctl.sh stop
\`\`\`
EOF

echo "${TARGET_DIR}"
