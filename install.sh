#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
OpenCode source checkout installer

Usage: ./install.sh [--tui-only | --with-web-ui]

Builds the current checkout for this machine and atomically installs the result.
The default CLI/TUI build does not embed WebUI assets.

Options:
  --tui-only    Compatibility alias for the default CLI/TUI build.
  --with-web-ui Embed WebUI assets for explicit web use.
  -h, --help    Show this help.

The two build-mode options cannot be combined. Plain opencode launches the TUI
in either build. Explicit opencode web and opencode serve commands remain
available in both builds.

Environment:
  OPENCODE_INSTALL_DIR  Destination directory (default: $HOME/.opencode/bin).

The exact Bun version pinned by package.json is used. If it is not already on
PATH, npx privately bootstraps it under the XDG cache. The installer never modifies shell configuration or persistently changes PATH.
EOF
}

fail() {
  printf 'Error: %s failed: %s\n' "$1" "$2" >&2
  exit 1
}

tui_only=false
with_web_ui=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tui-only)
      tui_only=true
      shift
      ;;
    --with-web-ui)
      with_web_ui=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'Error: Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ $tui_only == true && $with_web_ui == true ]]; then
  printf 'Error: --tui-only and --with-web-ui cannot be combined.\n\n' >&2
  usage >&2
  exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || fail "Repository discovery" "cannot resolve install.sh's directory"
package_json="$repo_root/package.json"
[[ -r "$package_json" ]] || fail "Bun pin" "cannot read $package_json"

package_manager=""
while IFS= read -r line || [[ -n $line ]]; do
  if [[ $line =~ \"packageManager\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
    package_manager="${BASH_REMATCH[1]}"
    break
  fi
done < "$package_json"

if [[ ! $package_manager =~ ^bun@([0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?)$ ]]; then
  fail "Bun pin" "package.json must contain an exact packageManager value such as bun@1.3.14"
fi
bun_version="${BASH_REMATCH[1]}"

raw_os=$(uname -s 2>/dev/null) || fail "Host detection" "uname -s is unavailable"
raw_arch=$(uname -m 2>/dev/null) || fail "Host detection" "uname -m is unavailable"
case "$raw_os" in
  Linux) target_os="linux" ;;
  Darwin) target_os="darwin" ;;
  *) fail "Unsupported host" "only Bash on Linux and macOS is supported (found $raw_os/$raw_arch)" ;;
esac
case "$raw_arch" in
  x86_64 | amd64) target_arch="x64" ;;
  arm64 | aarch64) target_arch="arm64" ;;
  *) fail "Unsupported host" "architecture $raw_arch is not supported on $raw_os" ;;
esac

if [[ ${OPENCODE_INSTALL_DIR+x} == x && -z ${OPENCODE_INSTALL_DIR} ]]; then
  fail "Install directory" "OPENCODE_INSTALL_DIR is empty; unset it or provide a destination"
fi
if [[ -z ${OPENCODE_INSTALL_DIR+x} && -z ${HOME:-} ]]; then
  fail "Install directory" "HOME is unset; set OPENCODE_INSTALL_DIR explicitly"
fi
install_dir="${OPENCODE_INSTALL_DIR:-$HOME/.opencode/bin}"

owned_path=""
staged_candidate=""
cleanup() {
  if [[ -n $owned_path ]]; then
    rm -f "$owned_path" 2>/dev/null || true
  fi
  if [[ -n $staged_candidate ]]; then
    rm -f "$staged_candidate" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM

bun_path=""
if detected_bun=$(command -v bun 2>/dev/null); then
  if [[ $detected_bun != /* ]]; then
    detected_bun="$(cd -- "$(dirname -- "$detected_bun")" && pwd -P)/$(basename -- "$detected_bun")"
  fi
  detected_version=$("$detected_bun" --version 2>/dev/null || true)
  if [[ $detected_version == "$bun_version" ]]; then
    bun_path="$detected_bun"
  else
    printf 'Bun on PATH is %s; privately bootstrapping required bun@%s.\n' "${detected_version:-unusable}" "$bun_version" >&2
  fi
fi

if [[ -z $bun_path ]]; then
  command -v npx >/dev/null 2>&1 || fail "Bun bootstrap" "npx is required when bun@$bun_version is not already on PATH"
  command -v mktemp >/dev/null 2>&1 || fail "Bun bootstrap" "mktemp is required for private bootstrap state"
  if [[ -n ${XDG_CACHE_HOME:-} ]]; then
    cache_root="$XDG_CACHE_HOME"
  elif [[ -n ${HOME:-} ]]; then
    cache_root="$HOME/.cache"
  else
    fail "Bun bootstrap" "set XDG_CACHE_HOME or HOME for the private Bun cache"
  fi
  bun_cache="$cache_root/opencode/source-installer/bun-$bun_version"
  if ! mkdir -p "$bun_cache/npm"; then
    fail "Bun bootstrap" "cannot create private cache at $bun_cache; choose a writable XDG_CACHE_HOME"
  fi
  owned_path=$(mktemp "$bun_cache/bun-path.XXXXXXXX") || fail "Bun bootstrap" "cannot create a private bootstrap path file"
  npx_path=$(command -v npx)
  if [[ $npx_path != /* ]]; then
    npx_path="$(cd -- "$(dirname -- "$npx_path")" && pwd -P)/$(basename -- "$npx_path")"
  fi
  if ! npm_config_cache="$bun_cache/npm" npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false \
    "$npx_path" --yes --package "bun@$bun_version" -- sh -c 'command -v bun' > "$owned_path"; then
    fail "Bun bootstrap" "npx could not download official bun@$bun_version; check npm connectivity and retry"
  fi
  bun_path=$(<"$owned_path")
  if [[ -z $bun_path || $bun_path == *$'\n'* || $bun_path != /* || ! -x $bun_path ]]; then
    fail "Bun bootstrap" "npx did not return one absolute executable path for bun@$bun_version"
  fi
  bootstrapped_version=$("$bun_path" --version 2>/dev/null || true)
  if [[ $bootstrapped_version != "$bun_version" ]]; then
    fail "Bun bootstrap" "downloaded runtime reported '${bootstrapped_version:-no version}', expected $bun_version"
  fi
  rm -f "$owned_path"
  owned_path=""
fi

bun_dir=$(dirname -- "$bun_path")
printf 'Installing frozen dependencies with bun@%s...\n' "$bun_version"
if ! (cd "$repo_root" && env PATH="$bun_dir:${PATH:-}" HUSKY=0 "$bun_path" install --frozen-lockfile); then
  fail "Frozen dependency installation" "bun install --frozen-lockfile failed; restore package.json/bun.lock consistency and retry"
fi

source_version="0.0.0-source-$(date -u +%Y%m%d%H%M)"
build_args=(run script/build.ts --single --skip-install)
if [[ $with_web_ui != true ]]; then
  build_args+=(--skip-embed-web-ui)
fi
printf 'Building %s from the current checkout...\n' "$([[ $with_web_ui == true ]] && printf 'opencode with embedded WebUI assets' || printf 'CLI/TUI opencode without embedded WebUI assets')"
if ! (
  cd "$repo_root/packages/opencode" &&
    env PATH="$bun_dir:${PATH:-}" OPENCODE_VERSION="$source_version" OPENCODE_CHANNEL=source \
      "$bun_path" "${build_args[@]}"
); then
  fail "Native source build" "the single-target build failed; review the build output above and retry"
fi

shopt -s nullglob
build_candidates=("$repo_root/packages/opencode/dist/opencode-$target_os-$target_arch"*/bin/opencode)
shopt -u nullglob
expected_output="$repo_root/packages/opencode/dist/opencode-$target_os-$target_arch/bin/opencode"
if [[ ${#build_candidates[@]} -ne 1 || ${build_candidates[0]:-} != "$expected_output" || ! -f $expected_output || ! -x $expected_output ]]; then
  fail "Build output" "expected one executable at $expected_output, found ${#build_candidates[@]}; remove ambiguous output and retry"
fi

if ! mkdir -p "$install_dir"; then
  fail "Install directory" "cannot create $install_dir; choose a writable OPENCODE_INSTALL_DIR (sudo is never used)"
fi
[[ -d $install_dir ]] || fail "Install directory" "$install_dir is not a directory"
install_dir=$(cd "$install_dir" && pwd -P) || fail "Install directory" "cannot resolve $install_dir"
target="$install_dir/opencode"
[[ ! -d $target ]] || fail "Install directory" "$target is a directory; move it aside before installing"

staged_candidate=$(mktemp "$install_dir/.opencode-install.XXXXXXXX") || fail "Candidate staging" "cannot create a unique staging file in $install_dir"
if ! cp "$expected_output" "$staged_candidate"; then
  fail "Candidate staging" "cannot copy the built binary into $install_dir; the existing opencode was not changed"
fi
if ! chmod 0755 "$staged_candidate"; then
  fail "Candidate permissions" "cannot set mode 0755 on the staged binary; the existing opencode was not changed"
fi
candidate_version=$("$staged_candidate" --version 2>/dev/null || true)
if [[ $candidate_version != "$source_version" ]]; then
  fail "Candidate validation" "staged --version reported '${candidate_version:-no version}', expected $source_version; the existing opencode was not changed"
fi
if ! mv -f "$staged_candidate" "$target"; then
  fail "Atomic replacement" "rename into $target failed; the existing opencode remains in place"
fi
staged_candidate=""

printf 'Installed source build %s to %s\n' "$source_version" "$target"
case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'export PATH=%q:"$PATH"\n' "$install_dir" ;;
esac
