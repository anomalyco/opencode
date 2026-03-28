#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SEC_CODE_BENCH_DIR="${SECURECODE_SEC_CODE_BENCH_DIR:-${SECURECODE_CACHE_ROOT:-${HOME}/.cache/securecode}/sec-code-bench}"
SUITE="${SECURECODE_SUITE:-product-eng-ja}"
LOCALE="${SECURECODE_LOCALE:-zh-CN}"

CASE_ID="${1:-order-webhook-router}"
VARIANT="${2:-prompt}"
MODE="${3:-print}"

usage() {
  echo "usage: $0 [case_id] [variant] [print|copy|path]" >&2
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

if [ "${SUITE}" = "product-eng-ja" ]; then
  PROMPT_PATH="$(mktemp)"
  if [ "${MODE}" != "path" ]; then
    trap 'rm -f "${PROMPT_PATH}"' EXIT
  fi
  python3 - <<'PY' "${ASSET_DIR}/workload/product_eng_ja_workload.json" "${CASE_ID}" "${VARIANT}" "${PROMPT_PATH}"
import json, sys
from pathlib import Path
rows = json.loads(Path(sys.argv[1]).read_text())
case_id = sys.argv[2]
variant = sys.argv[3]
out = Path(sys.argv[4])
row = next((item for item in rows if item["id"] == case_id), None)
if row is None:
    raise SystemExit(f"case not found: {case_id}")
text = row["prompt"] if variant == "prompt" else row["session_script"][variant]
out.write_text(text)
PY
else
  if [ ! -d "${SEC_CODE_BENCH_DIR}" ]; then
    echo "sec-code-bench cache not found: ${SEC_CODE_BENCH_DIR}" >&2
    exit 1
  fi

  SUFFIX="$(suffix_for_scenario "${VARIANT}")"
  PROMPT_PATH="${SEC_CODE_BENCH_DIR}/datasets/benchmark/java/prompts/${CASE_ID}${SUFFIX}.${LOCALE}"
fi

if [ ! -f "${PROMPT_PATH}" ]; then
  echo "prompt not found: ${PROMPT_PATH}" >&2
  exit 1
fi

case "${MODE}" in
  print)
    cat "${PROMPT_PATH}"
    ;;
  copy)
    if command -v pbcopy >/dev/null 2>&1; then
      pbcopy < "${PROMPT_PATH}"
    elif command -v wl-copy >/dev/null 2>&1; then
      wl-copy < "${PROMPT_PATH}"
    elif command -v xclip >/dev/null 2>&1; then
      xclip -selection clipboard < "${PROMPT_PATH}"
    elif command -v xsel >/dev/null 2>&1; then
      xsel --clipboard --input < "${PROMPT_PATH}"
    else
      echo "no supported clipboard command found (pbcopy, wl-copy, xclip, xsel)" >&2
      exit 1
    fi
    echo "copied: ${PROMPT_PATH}"
    ;;
  path)
    echo "${PROMPT_PATH}"
    ;;
  *)
    usage
    ;;
esac
