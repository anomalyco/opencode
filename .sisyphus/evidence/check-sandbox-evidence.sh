#!/usr/bin/env bash
set -euo pipefail

state="${1:-}"
evidence_file="${2:-}"
repo_root="${OPENCODE_SANDBOX_REPO_ROOT:-/home/choza/projects/opencode-source}"
evidence_dir="${OPENCODE_SANDBOX_EVIDENCE_DIR:-$repo_root/.sisyphus/evidence}"

if [[ -z "$state" ]]; then
  echo "Usage: $0 <error|final|stream|tool|warning|idle> [evidence-file]"
  exit 1
fi

if [[ -z "$evidence_file" ]]; then
  evidence_file="$evidence_dir/task-2-${state}.txt"
fi

if [[ "$state" != "idle" ]]; then
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
fi

strip_ansi() {
  sed -E 's/\x1b\[[0-9;]*[mK]//g'
}

filter_prompt_line() {
  local prompt_text="$1"
  strip_ansi < "$evidence_file" | rg -vF "$prompt_text"
}

extract_prompt_line_raw() {
  local file="$1"
  local model="${OPENCODE_SANDBOX_MODEL:-}"

  if [[ -n "$model" ]]; then
    local provider="${model%%/*}"
    local model_id="${model#*/}"
    rg -m1 -i -F "$model_id" "$file" || rg -m1 -i -F "$provider" "$file" \
      || rg -m1 "Ask anything" "$file" || rg -m1 "Build" "$file" || true
    return
  fi

  rg -m1 "Ask anything" "$file" || rg -m1 "Build" "$file" || true
}

extract_background_code() {
  local line="$1"
  printf '%s' "$line" | rg -o $'\x1b\[48;2;[0-9;]+' -m1 || true
}

extract_prompt_line() {
  strip_ansi < "$1" | rg -m1 "Ask anything|Build"
}

case "$state" in
  idle)
    expect_cycle="${OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE:-1}"
    local_file_a="$evidence_dir/task-2-idle-a.txt"
    local_file_b="$evidence_dir/task-2-idle-b.txt"
    local_file_c="$evidence_dir/task-2-idle-c.txt"

    if [[ ! -f "$local_file_a" || ! -f "$local_file_b" ]]; then
      echo "Missing idle evidence files: $local_file_a or $local_file_b"
      exit 1
    fi

    line_a="$(extract_prompt_line_raw "$local_file_a")"
    line_b="$(extract_prompt_line_raw "$local_file_b")"

    if [[ -z "$line_a" || -z "$line_b" ]]; then
      echo "Missing prompt bar line in idle evidence"
      exit 1
    fi

    if [[ "$expect_cycle" == "1" ]]; then
      bg_a="$(extract_background_code "$line_a")"
      bg_b="$(extract_background_code "$line_b")"

      if [[ -n "$bg_a" && -n "$bg_b" ]]; then
        if [[ "$bg_a" == "$bg_b" ]]; then
          if [[ -f "$local_file_c" ]]; then
            line_c="$(extract_prompt_line_raw "$local_file_c")"
            bg_c="$(extract_background_code "$line_c")"
            if [[ -z "$bg_c" || "$bg_b" == "$bg_c" ]]; then
              echo "Idle prompt bar background did not change between captures"
              exit 1
            fi
          else
            echo "Idle prompt bar background did not change between captures"
            exit 1
          fi
        fi
      else
        if [[ "$line_a" == "$line_b" ]]; then
          if [[ -f "$local_file_c" ]]; then
            line_c="$(extract_prompt_line_raw "$local_file_c")"
            if [[ "$line_b" == "$line_c" ]]; then
              echo "Idle prompt bar line did not change between captures"
              exit 1
            fi
          else
            echo "Idle prompt bar line did not change between captures"
            exit 1
          fi
        fi
      fi
    fi
    ;;
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
