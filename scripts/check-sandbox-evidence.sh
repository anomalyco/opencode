#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [options] <error|final|stream|tool|warning|idle> [evidence-file]"
  echo ""
  echo "Options:"
  echo "  --repo-root PATH"
  echo "  --evidence-dir PATH"
  echo "  --evidence-file PATH"
  echo "  --model NAME"
  echo "  --expect-idle-cycle[=VALUE]"
  echo "  -h, --help"
  echo ""
  echo "Env vars are deprecated (OPENCODE_SANDBOX_*). Prefer flags above."
}

warn_env() {
  echo "Deprecated: $1 is set. Use $2 instead." >&2
}

state=""
evidence_file=""
repo_root=""
evidence_dir=""
model=""
expect_cycle=""

repo_root_arg=0
evidence_dir_arg=0
evidence_file_arg=0
model_arg=0
expect_cycle_arg=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --repo-root)
      repo_root="$2"
      repo_root_arg=1
      shift 2
      ;;
    --repo-root=*)
      repo_root="${1#*=}"
      repo_root_arg=1
      shift
      ;;
    --evidence-dir)
      evidence_dir="$2"
      evidence_dir_arg=1
      shift 2
      ;;
    --evidence-dir=*)
      evidence_dir="${1#*=}"
      evidence_dir_arg=1
      shift
      ;;
    --evidence-file)
      evidence_file="$2"
      evidence_file_arg=1
      shift 2
      ;;
    --evidence-file=*)
      evidence_file="${1#*=}"
      evidence_file_arg=1
      shift
      ;;
    --model)
      model="$2"
      model_arg=1
      shift 2
      ;;
    --model=*)
      model="${1#*=}"
      model_arg=1
      shift
      ;;
    --expect-idle-cycle)
      expect_cycle="1"
      expect_cycle_arg=1
      shift
      ;;
    --expect-idle-cycle=*)
      expect_cycle="${1#*=}"
      expect_cycle_arg=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "$state" ]]; then
        state="$1"
        shift
        continue
      fi
      if [[ -z "$evidence_file" && "$evidence_file_arg" != "1" ]]; then
        evidence_file="$1"
        shift
        continue
      fi
      echo "Unexpected argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$state" ]]; then
  usage
  exit 1
fi

repo_root="${repo_root:-${OPENCODE_SANDBOX_REPO_ROOT:-/home/choza/projects/opencode-source}}"
evidence_dir="${evidence_dir:-${OPENCODE_SANDBOX_EVIDENCE_DIR:-$repo_root/.sisyphus/evidence}}"
model="${model:-${OPENCODE_SANDBOX_MODEL:-}}"
expect_cycle="${expect_cycle:-${OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE:-}}"

if [[ -n "$expect_cycle" ]]; then
  case "$expect_cycle" in
    1|true|TRUE|yes|YES|on|ON) expect_cycle="1" ;;
    0|false|FALSE|no|NO|off|OFF) expect_cycle="0" ;;
  esac
fi

if [[ "$repo_root_arg" != "1" && -n "${OPENCODE_SANDBOX_REPO_ROOT:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_REPO_ROOT" "--repo-root"
fi
if [[ "$evidence_dir_arg" != "1" && -n "${OPENCODE_SANDBOX_EVIDENCE_DIR:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_EVIDENCE_DIR" "--evidence-dir"
fi
if [[ "$model_arg" != "1" && -n "${OPENCODE_SANDBOX_MODEL:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_MODEL" "--model"
fi
if [[ "$expect_cycle_arg" != "1" && -n "${OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE:-}" ]]; then
  warn_env "OPENCODE_SANDBOX_EXPECT_IDLE_CYCLE" "--expect-idle-cycle"
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
    expect_cycle="${expect_cycle:-0}"
    local_file_a="$evidence_dir/task-2-idle-a.txt"
    local_file_b="$evidence_dir/task-2-idle-b.txt"
    local_file_c="$evidence_dir/task-2-idle-c.txt"

    if [[ ! -f "$local_file_a" || ! -f "$local_file_b" ]]; then
      echo "Missing idle evidence files: $local_file_a or $local_file_b"
      exit 1
    fi

    codes_a="$(rg -o $'\x1b\[48;2;[0-9;]+' "$local_file_a" || true)"
    codes_b="$(rg -o $'\x1b\[48;2;[0-9;]+' "$local_file_b" || true)"
    unique_a="$(printf '%s\n' "$codes_a" | rg -v '^$' | sort -u | rg -c '.' || true)"
    if [[ -z "$unique_a" ]]; then
      unique_a=0
    fi
    if [[ "$unique_a" -lt 4 ]]; then
      echo "Idle prompt bar lacks spatial background variation"
      exit 1
    fi

    if [[ "$expect_cycle" == "1" ]]; then
      seq_a="$(printf '%s\n' "$codes_a" | rg -v '^$' | tr '\n' ' ' || true)"
      seq_b="$(printf '%s\n' "$codes_b" | rg -v '^$' | tr '\n' ' ' || true)"
      if [[ "$seq_a" == "$seq_b" ]]; then
        if [[ -f "$local_file_c" ]]; then
          codes_c="$(rg -o $'\x1b\[48;2;[0-9;]+' "$local_file_c" || true)"
          seq_c="$(printf '%s\n' "$codes_c" | rg -v '^$' | tr '\n' ' ' || true)"
          if [[ "$seq_b" == "$seq_c" ]]; then
            echo "Idle prompt bar background sequence did not change between captures"
            exit 1
          fi
        else
          echo "Idle prompt bar background sequence did not change between captures"
          exit 1
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
