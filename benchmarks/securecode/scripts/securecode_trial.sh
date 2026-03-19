#!/usr/bin/env bash
set -euo pipefail

SEC_CODE_BENCH_DIR="${SECURECODE_SEC_CODE_BENCH_DIR:-${SECURECODE_CACHE_ROOT:-${HOME}/.cache/securecode}/sec-code-bench}"
LOCALE="${SECURECODE_LOCALE:-zh-CN}"

CASE_ID="${1:-InjectionJDBC}"
SCENARIO="${2:-fix-hints}"
MODE="${3:-print}"

usage() {
  echo "usage: $0 [case_id] [gen|gen-hints|fix|fix-hints] [print|copy|path]" >&2
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
  echo "sec-code-bench cache not found: ${SEC_CODE_BENCH_DIR}" >&2
  exit 1
fi

SUFFIX="$(suffix_for_scenario "${SCENARIO}")"
PROMPT_PATH="${SEC_CODE_BENCH_DIR}/datasets/benchmark/java/prompts/${CASE_ID}${SUFFIX}.${LOCALE}"

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
