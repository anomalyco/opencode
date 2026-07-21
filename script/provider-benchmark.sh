#!/usr/bin/env bash

# Cold OpenCode clone/install/typecheck benchmark for a fresh x86_64 VM.
# Supports apt-get and dnf based images.

set -euo pipefail

REPO_URL="${BENCH_REPO_URL:-https://github.com/anomalyco/opencode.git}"
COMMIT="${BENCH_COMMIT:-08fb47373509ba64b13441061314eeacf4264f51}"
BUN_VERSION="${BENCH_BUN_VERSION:-1.3.14}"
NODE_VERSION="${BENCH_NODE_VERSION:-24.14.1}"
ROOT="${BENCH_ROOT:-/tmp/opencode-provider-benchmark}"
KEEP_ROOT="${BENCH_KEEP_ROOT:-false}"
PROVIDER="${BENCH_PROVIDER:-unknown}"
REGION="${BENCH_REGION:-unknown}"

declare -A PHASE_MS=()

timestamp() {
  date +%s%N
}

phase() {
  local name="$1"
  shift
  local start end
  start="$(timestamp)"
  set +e
  "$@"
  local status=$?
  set -e
  end="$(timestamp)"
  PHASE_MS["$name"]="$(( (end - start) / 1000000 ))"
  printf 'BENCH_PHASE\t%s\t%s\n' "$name" "${PHASE_MS[$name]}"
  return "$status"
}

seconds() {
  awk -v milliseconds="${1:-0}" 'BEGIN { printf "%.3fs", milliseconds / 1000 }'
}

render_table() {
  local result="$1"
  local typecheck="—"
  local workload="—"
  if [[ -n "${PHASE_MS[typecheck]:-}" ]]; then
    typecheck="$(seconds "${PHASE_MS[typecheck]}")"
  fi
  if [[ "$result" == "✅" ]]; then
    workload="$(seconds "$(( ${PHASE_MS[clone]} + ${PHASE_MS[install]} + ${PHASE_MS[typecheck]} ))")"
  elif [[ -n "${PHASE_MS[typecheck]:-}" ]]; then
    typecheck="${typecheck} (failed)"
  fi
  local memory
  memory="$(awk '/MemTotal/{printf "%.2f GiB", $2 / 1048576}' /proc/meminfo)"
  local cpu_model
  cpu_model="$(awk -F: '/model name/{gsub(/^[ \t]+/, "", $2); print $2; exit}' /proc/cpuinfo)"
  printf '\n| Provider | CPU / RAM | Region / CPU | Clone | Install | Typecheck | Workload total | Result |\n'
  printf '|---|---|---|---:|---:|---:|---:|---|\n'
  printf '| **%s** | %s CPU / %s | %s, %s | %s | %s | %s | %s | %s |\n' \
    "$PROVIDER" \
    "$(getconf _NPROCESSORS_ONLN)" \
    "$memory" \
    "$REGION" \
    "$cpu_model" \
    "$(seconds "${PHASE_MS[clone]:-0}")" \
    "$(seconds "${PHASE_MS[install]:-0}")" \
    "$typecheck" \
    "$workload" \
    "$result"
}

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
elif command -v sudo >/dev/null; then
  SUDO=(sudo)
else
  printf 'BENCH_ERROR\tprepare\troot_or_sudo_required\n' >&2
  exit 1
fi

prepare() {
  if command -v apt-get >/dev/null; then
    "${SUDO[@]}" apt-get update -qq
    "${SUDO[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      bash build-essential ca-certificates curl git python3 python3-setuptools unzip xz-utils
  elif command -v dnf >/dev/null; then
    "${SUDO[@]}" dnf install -y -q \
      bash ca-certificates gcc gcc-c++ make git python3 python3-setuptools tar unzip xz
  else
    printf 'BENCH_ERROR\tprepare\tapt_get_or_dnf_required\n' >&2
    return 1
  fi
  python3 -c 'import setuptools'

  if [[ "$(node --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
    local archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
    local prefix="/opt/node-v${NODE_VERSION}-linux-x64"
    curl -fsSL "https://nodejs.org/download/release/v${NODE_VERSION}/${archive}" -o "/tmp/${archive}"
    "${SUDO[@]}" rm -rf "$prefix"
    "${SUDO[@]}" mkdir -p "$prefix"
    "${SUDO[@]}" tar -xJf "/tmp/${archive}" --strip-components=1 -C "$prefix"
    for executable in node npm npx corepack; do
      "${SUDO[@]}" ln -sfn "$prefix/bin/$executable" "/usr/local/bin/$executable"
    done
  fi
  test "$(node --version)" = "v${NODE_VERSION}"
}

download_bun() {
  curl -fsSL \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64-baseline.zip" \
    -o "$ROOT/bun.zip"
}

unpack_bun() {
  unzip -q -j "$ROOT/bun.zip" bun-linux-x64-baseline/bun -d "$BUN_INSTALL/bin"
  chmod +x "$BUN_INSTALL/bin/bun"
}

clone_repo() {
  mkdir "$ROOT/repo"
  cd "$ROOT/repo"
  git init -q
  git remote add origin "$REPO_URL"
  git fetch -q --depth=1 origin "$COMMIT"
  git checkout -q --detach FETCH_HEAD
  test "$(git rev-parse HEAD)" = "$COMMIT"
}

install_dependencies() {
  cd "$ROOT/repo"
  bun install
  git diff --exit-code -- bun.lock package.json
}

typecheck() {
  cd "$ROOT/repo"
  bun typecheck
}

disk() {
  du -sx --block-size=1 "$ROOT" | awk '{print $1}'
}

clear_caches() {
  rm -rf "$ROOT"
  "${SUDO[@]}" sync
  if "${SUDO[@]}" sh -c 'echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null; then
    printf 'BENCH_CACHE\tguest_page_cache\tdropped\n'
  else
    printf 'BENCH_CACHE\tguest_page_cache\tunavailable\n'
  fi
  printf 'BENCH_CACHE\tworkspace\tfresh\n'
  printf 'BENCH_CACHE\tbun\tempty\n'
  printf 'BENCH_CACHE\tturbo\tempty\n'
}

cleanup() {
  local status=$?
  if [[ "$KEEP_ROOT" != "true" ]]; then
    rm -rf "$ROOT"
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

total_start="$(timestamp)"
if ! phase prepare prepare; then
  render_table "❌ prepare"
  exit 1
fi

phase cache_clear clear_caches
mkdir -p "$ROOT/bun/bin" "$ROOT/home" "$ROOT/bun-cache"
export HOME="$ROOT/home"
export BUN_INSTALL="$ROOT/bun"
export BUN_INSTALL_CACHE_DIR="$ROOT/bun-cache"
export PATH="$BUN_INSTALL/bin:$PATH"
export CI=true
export OPENCODE_DISABLE_SHARE=true
export TURBO_TELEMETRY_DISABLED=1

printf 'BENCH_META\tcommit\t%s\n' "$COMMIT"
printf 'BENCH_META\tarchitecture\t%s\n' "$(uname -m)"
printf 'BENCH_META\tkernel\t%s\n' "$(uname -sr)"
printf 'BENCH_META\tlogical_cpus\t%s\n' "$(getconf _NPROCESSORS_ONLN)"
printf 'BENCH_META\tcpu_model\t%s\n' "$(awk -F: '/model name/{gsub(/^[ \t]+/, "", $2); print $2; exit}' /proc/cpuinfo)"
printf 'BENCH_META\tmemory_kib\t%s\n' "$(awk '/MemTotal/{print $2}' /proc/meminfo)"

if ! phase bun_download download_bun; then
  render_table "❌ Bun download"
  exit 1
fi
if ! phase bun_unpack unpack_bun; then
  render_table "❌ Bun unpack"
  exit 1
fi
printf 'BENCH_META\tbun_version\t%s\n' "$(bun --version)"
printf 'BENCH_META\tnode_version\t%s\n' "$(node --version)"

if ! phase clone clone_repo; then
  render_table "❌ clone"
  exit 1
fi
printf 'BENCH_DISK\tafter_clone\t%s\n' "$(disk)"
if ! phase install install_dependencies; then
  render_table "❌ install"
  exit 1
fi
printf 'BENCH_DISK\tafter_install\t%s\n' "$(disk)"
if ! phase typecheck typecheck; then
  render_table "❌ typecheck"
  exit 1
fi
printf 'BENCH_DISK\tafter_typecheck\t%s\n' "$(disk)"
printf 'BENCH_DONE\t%s\n' "$(git -C "$ROOT/repo" rev-parse HEAD)"
total_end="$(timestamp)"
printf 'BENCH_PHASE\ttotal\t%s\n' "$(( (total_end - total_start) / 1000000 ))"
render_table "✅"
