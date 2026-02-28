#!/usr/bin/env bash
set -euo pipefail

state="${1:-}"
evidence_file="${2:-}"
evidence_dir="/home/choza/projects/opencode-source/.sisyphus/evidence"

if [[ -z "$state" ]]; then
  echo "Usage: $0 <error|final|stream|tool|warning> [evidence-file]"
  exit 1
fi

if [[ -z "$evidence_file" ]]; then
  evidence_file="$evidence_dir/task-2-${state}.txt"
fi

if [[ ! -f "$evidence_file" ]]; then
  echo "Evidence file not found: $evidence_file"
  exit 1
fi

if [[ ! -s "$evidence_file" ]]; then
  echo "Evidence file is empty: $evidence_file"
  exit 1
fi

if ! grep -q $'\x1b\[' "$evidence_file"; then
  echo "ANSI escape sequences not found in: $evidence_file"
  exit 1
fi

strip_ansi() {
  sed -E 's/\x1b\[[0-9;]*[mK]//g'
}

filter_prompt_line() {
  local prompt_text="$1"
  strip_ansi < "$evidence_file" | rg -vF "$prompt_text"
}

case "$state" in
  error)
    rg -q "Incorrect API key provided:" "$evidence_file" || {
      echo "Missing error marker in $evidence_file"
      exit 1
    }
    ;;
  final)
    filter_prompt_line "Say 'ready'" | rg -q "ready" || {
      echo "Missing final marker outside prompt line in $evidence_file"
      exit 1
    }
    ;;
  tool)
    filter_prompt_line 'Run `echo ok`' | rg -q "Handling injected command request|\bok\b" || {
      echo "Missing tool marker outside prompt line in $evidence_file"
      exit 1
    }
    ;;
  warning)
    strip_ansi < "$evidence_file" | rg -qi "No such file or directory|cannot access" || {
      echo "Missing warning marker in $evidence_file"
      exit 1
    }
    ;;
  stream)
    strip_ansi < "$evidence_file" | rg -q "Write a long paragraph" || {
      echo "Missing stream prompt in $evidence_file"
      exit 1
    }
    filter_prompt_line "Write a long paragraph about ocean weather." | rg -qi "ocean|weather" || {
      echo "Missing stream content outside prompt line in $evidence_file"
      exit 1
    }
    ;;
  *)
    echo "Unknown state: $state"
    exit 1
    ;;
esac

echo "Evidence OK: $state ($evidence_file)"
