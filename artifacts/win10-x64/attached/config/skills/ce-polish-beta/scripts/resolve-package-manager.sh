#!/usr/bin/env bash
#
# resolve-package-manager.sh — detect which JS package manager a project uses
# by inspecting lockfiles, and emit the binary name plus canonical command tail.
#
# Usage:
#   resolve-package-manager.sh [path]
#
# Arguments:
#   path (optional) — directory to inspect. When omitted, defaults to the
#                     repo root via `git rev-parse --show-toplevel`.
#
# Output contract (two lines on stdout):
#   Line 1: package-manager binary token (`npm` | `pnpm` | `yarn` | `bun`)
#   Line 2: canonical argv tail for running a dev script
#            - npm:  "run dev"   (npm requires the `run` verb)
#            - pnpm: "dev"       (pnpm allows bare script names)
#            - yarn: "dev"       (yarn allows bare script names)
#            - bun:  "run dev"   (bun requires the `run` verb)
#
# Lockfile priority order (first match wins):
#   1. pnpm-lock.yaml    -> pnpm
#   2. yarn.lock          -> yarn
#   3. bun.lock           -> bun  (text format, preferred — newer canonical)
#   4. bun.lockb          -> bun  (binary format, legacy)
#   5. package-lock.json  -> npm
#   When both bun.lock and bun.lockb are present, bun.lock (text) is checked
#   first and wins because it is the newer canonical format.
#
# Sentinel (stdout, exit 0):
#   __NO_PACKAGE_JSON__  — the target directory has no package.json
#
# Errors (stderr, exit 1):
#   ERROR: <message>     — path does not exist, is not a directory, or
#                          no positional arg and not inside a git repo

set -u

TARGET_PATH="${1:-}"

# Resolve target directory: positional arg or git repo root.
if [ -n "$TARGET_PATH" ]; then
  if [ ! -d "$TARGET_PATH" ]; then
    echo "ERROR: path does not exist or is not a directory: $TARGET_PATH" >&2
    exit 1
  fi
else
  TARGET_PATH=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$TARGET_PATH" ]; then
    echo "ERROR: not in a git repository and no path argument provided" >&2
    exit 1
  fi
fi

# Sentinel: no package.json means this is not a JS/TS project.
if [ ! -f "$TARGET_PATH/package.json" ]; then
  echo "__NO_PACKAGE_JSON__"
  exit 0
fi

# Check lockfiles in priority order.
if [ -f "$TARGET_PATH/pnpm-lock.yaml" ]; then
  echo "pnpm"
  echo "dev"
  exit 0
fi

if [ -f "$TARGET_PATH/yarn.lock" ]; then
  echo "yarn"
  echo "dev"
  exit 0
fi

if [ -f "$TARGET_PATH/bun.lock" ]; then
  echo "bun"
  echo "run dev"
  exit 0
fi

if [ -f "$TARGET_PATH/bun.lockb" ]; then
  echo "bun"
  echo "run dev"
  exit 0
fi

if [ -f "$TARGET_PATH/package-lock.json" ]; then
  echo "npm"
  echo "run dev"
  exit 0
fi

# Fallback: package.json present but no recognized lockfile.
echo "npm"
echo "run dev"
exit 0
