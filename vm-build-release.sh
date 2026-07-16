#!/usr/bin/env bash
#
# vm-build-release.sh — build our forked opencode CLI and publish it to S3.
#
# Cross-compiles the CLI with Bun's single-file compiler, then uploads the
# glibc-Linux targets the vm-app sandbox needs to:
#
#     s3://<bucket>/<version>/opencode-<target>.tar.gz
#     s3://<bucket>/<version>/manifest.json     (version, git commit, sha256s)
#
# Version lives in the S3 *key path* (the primary version scheme); the bucket's
# S3 object-versioning is just a backstop against accidental overwrite.
#
# Usage:
#   ./vm-build-release.sh <version> [--latest] [--force] [--skip-web-ui]
#
#   <version>       Release version, e.g. 1.18.3-vm  (goes in the S3 path)
#   --latest        Also copy this version's artifacts to s3://<bucket>/latest/
#   --force         Overwrite an already-published version (default: refuse)
#   --skip-web-ui   Faster/smaller build; skips embedding opencode's web console
#                   (the vm-app sandbox uses the HTTP API, not the web console)
#
# Env overrides:
#   VM_OPENCODE_BUCKET   S3 bucket name (default: vm-opencode-releases)
#
# Requires: bun, aws (v2, credentials configured), tar, and sha256sum/shasum.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BUCKET="${VM_OPENCODE_BUCKET:-vm-opencode-releases}"

# The vm-app sandbox base image is python:3.12-slim-bookworm (Debian, glibc),
# built for whatever arch Docker runs on. So we ship both glibc-Linux arches.
# NOT the *-musl / darwin / windows targets — nothing else runs the CLI.
TARGETS=("linux-x64" "linux-arm64")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_SCRIPT="$REPO_ROOT/packages/opencode/script/build.ts"
DIST_DIR="$REPO_ROOT/packages/opencode/dist"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
VERSION=""
MARK_LATEST=0
FORCE=0
SKIB_UI=0

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --latest)      MARK_LATEST=1 ;;
    --force)       FORCE=1 ;;
    --skip-web-ui) SKIP_WEB_UI=1 ;;
    -h|--help)     usage 0 ;;
    -*)            echo "Unknown option: $1" >&2; usage 1 ;;
    *)
      if [[ -n "$VERSION" ]]; then echo "Unexpected argument: $1" >&2; usage 1; fi
      VERSION="$1" ;;
  esac
  shift
done

[[ -n "$VERSION" ]] || { echo "ERROR: version argument is required." >&2; usage 1; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

s3_key_exists() { aws s3 ls "s3://$BUCKET/$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
for tool in bun aws tar; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found on PATH: $tool"
done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 \
  || die "need sha256sum or shasum for integrity hashes"

log "Checking AWS credentials..."
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials not working (aws sts get-caller-identity failed)"

# Refuse to clobber an already-published version unless --force.
if s3_key_exists "$VERSION/manifest.json"; then
  if [[ $FORCE -eq 0 ]]; then
    die "version '$VERSION' already published at s3://$BUCKET/$VERSION/ — bump the version, or pass --force to overwrite."
  fi
  warn "version '$VERSION' already exists — overwriting because --force was given (old objects stecoverable via S3 versioning)."
fi

# Record provenance. A dirty tree means the build isn't reproducible from a commit.
GIT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then
  GIT_DIRTY=true
  warn "working tree has uncommitted changes — this release won't be reproducible from commit $GIT_COMMIT."
else
  GIT_DIRTY=false
fi

# ---------------------------------------------------------------------------
# Build (full cross-compile — produces all targets; we upload the Linux ones)
# ---------------------------------------------------------------------------
cd "$REPO_ROOT"

log "Installing dependencies (bun install)..."
bun install

BUILD_ARGS=()
[[ $SKIP_WEB_UI -eq 1 ]] && BUILD_ARGS+=(--skip-embed-web-ui)

log "Building opencode $VERSION (cross-compiling all targets)..."
OPENCODE_VERSION="$VERSION" bun run "$BUILD_SCRIPT" "${BUILD_ARGS[@]}"

# -----------------------------------------------------------------------
# Package + upload the Linux targets
# ---------------------------------------------------------------------------
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
artifacts_json=""

for target in "${TARGETS[@]}"; do
  bindir="$DIST_DIR/opencode-$target/bin"
  [[ -x "$bindir/opencode" ]] || die "expected binary missing: $bindir/opencode (did the build fail for $target?)"

  archive="$DIST_DIR/opencode-$target.tar.gz"
  log "Packaging $target -> $(basename "$archive")"
  tar -czf "$archive" -C "$bindir" .

  sha="$(sha256_of "$archive")"
  bytes="$(wc -c < "$archive" | tr -d ' ')"
  key="$VERSION/opencode-$target.tar.gz"

  log "Uploading s3://$BUCKET/$key  (sha256 ${sha:0:12}…, ${bytes} bytes)"
  aws s3 cp "$archive" "s3://$BUCKET/$key" \
    --content-type application/gzip \
    --metadata "version=$VERSION,git-commit=$GIT_COMMIT,sha256=$sha"

  entry="$(printf '{"target":"%s","key":"%s","sha256":"%s","bytes":%s}' "$target" "$key" "$sha" "$bytes")"
  artifacts_json="${artifacts_json:+$artifacts_json,}$eny"
done

# ---------------------------------------------------------------------------
# Manifest — the source of truth for "what is version X"
# ---------------------------------------------------------------------------
manifest_file="$DIST_DIR/manifest-$VERSION.json"
printf '{\n  "version": "%s",\n  "git_commit": "%s",\n  "git_dirty": %s,\n  "built_at": "%s",\n  "bucket": "%s",\n  "artifacts": [%s]\n}\n' \
  "$VERSION" "$GIT_COMMIT" "$GIT_DIRTY" "$BUILT_AT" "$BUCKET" "$artifacts_json" > "$manifest_file"

log "Uploading manifest -> s3://$BUCKET/$VERSION/manifest.json"
aws s3 cp "$manifest_file" "s3://$BUCKET/$VERSION/manifest.json" --content-type application/json

# ---------------------------------------------------------------------------
# Optional: move the "latest" pointer (server-side copy, no re-upload)
# ---------------------------------------------------------------------------
if [[ $MARK_LATEST -eq 1 ]]; then
  log "Updating latest/ pointer..."
  for target in "${TARGETS[@]}"; do
    aws s3 c"s3://$BUCKET/$VERSION/opencode-$target.tar.gz" \
              "s3://$BUCKET/latest/opencode-$target.tar.gz" --content-type application/gzip
  done
  aws s3 cp "s3://$BUCKET/$VERSION/manifest.json" \
            "s3://$BUCKET/latest/manifest.json" --content-type application/json
  warn "latest/ now points at $VERSION — keep the sandbox Dockerfile pinned to an explicit version, not latest/."
fi

log "Done. Published opencode $VERSION to s3://$BUCKET/$VERSION/"
echo
echo "  Pull in the sandbox Dockerfile with (per arch):"
echo "    aws s3 cp s3://$BUCKET/$VERSION/opencode-linux-\${ARCH}.tar.gz - | tar -xz -C /usr/local/bin"
