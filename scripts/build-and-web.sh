#!/usr/bin/env bash
set -euo pipefail

# Build the opencode CLI bundle, then start the web server.
# Uses the binary under packages/opencode/dist/ — the Node wrapper in bin/opencode only
# resolves packages installed as node_modules/opencode-<platform>-<arch>, not local dist/.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bun run build

resolve_opencode_binary() {
  local os arch name exe p
  exe=opencode

  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MSYS_* | MINGW* | CYGWIN*) os=windows ;;
    *)
      echo "Unsupported OS: $(uname -s)" >&2
      return 1
      ;;
  esac

  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *)
      echo "Unsupported CPU: $(uname -m)" >&2
      return 1
      ;;
  esac

  if [[ "$os" == "windows" ]]; then
    exe=opencode.exe
  fi

  name="opencode-${os}-${arch}"
  p="${ROOT}/packages/opencode/dist/${name}/bin/${exe}"
  if [[ -f "$p" ]]; then
    echo "$p"
    return 0
  fi

  # x64 optional baseline build (matches script/build.ts when AVX2 is absent)
  if [[ "$arch" == "x64" ]]; then
    p="${ROOT}/packages/opencode/dist/${name}-baseline/bin/${exe}"
    if [[ -f "$p" ]]; then
      echo "$p"
      return 0
    fi
  fi

  echo "No compiled binary at packages/opencode/dist/${name}/bin/${exe} (or -baseline on x64)." >&2
  echo "Run from repo root: bun run build" >&2
  return 1
}

BIN="$(resolve_opencode_binary)"
exec "$BIN" web "$@"
