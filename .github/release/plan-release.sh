#!/usr/bin/env bash
# plan-release.sh: decides version, channel and npm dist-tag from the event, ref and dispatch inputs
# (INPUT_BUMP, INPUT_VERSION) only, and writes them to $GITHUB_OUTPUT. Nothing here reads repository files.
#
#   push or dispatch on dev           -> dev      0.0.0-dev-<run>     npm tag dev
#   dispatch on dev with bump/version -> latest   x.y.z               npm tag latest
#   push or dispatch on beta          -> beta     0.0.0-beta-<run>    desktop only
#   pull_request                      -> pr       0.0.0-pr-<run>      everything, dry run
. "$(dirname "$0")/lib.sh"

versioned=false
if [ -n "${INPUT_BUMP:-}" ] || [ -n "${INPUT_VERSION:-}" ]; then versioned=true; fi
case "$GITHUB_EVENT_NAME:$GITHUB_REF:$versioned" in
  push:refs/heads/dev:false | workflow_dispatch:refs/heads/dev:false) channel="dev" ;;
  workflow_dispatch:refs/heads/dev:true) channel="latest" ;;
  push:refs/heads/beta:false | workflow_dispatch:refs/heads/beta:false) channel="beta" ;;
  pull_request:*:false) channel="pr" ;;
  *) die "$GITHUB_EVENT_NAME on $GITHUB_REF cannot publish (versioned: $versioned)" ;;
esac

if [ "$channel" = latest ] && [ -n "${INPUT_VERSION:-}" ]; then
  version=$INPUT_VERSION
elif [ "$channel" = latest ]; then
  current=$(curl -fsS https://registry.npmjs.org/-/package/@opencode%2fcli/dist-tags | jq -r .latest)
  [[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "Unexpected latest version: $current"
  major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
  case "$INPUT_BUMP" in
    major) version="$((major + 1)).0.0" ;;
    minor) version="$major.$((minor + 1)).0" ;;
    *) version="$major.$minor.$((patch + 1))" ;;
  esac
  if [ "$major" -lt 2 ]; then version=2.0.0; fi
else
  version="0.0.0-$channel-$GITHUB_RUN_NUMBER"
  if [ "$GITHUB_RUN_ATTEMPT" != 1 ]; then version="$version.$GITHUB_RUN_ATTEMPT"; fi
fi

if [ "$channel" = latest ]; then
  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || [[ "$version" == 0.0.0-* ]]; then
    die "Invalid release version: $version"
  fi
  status=$(curl -sS -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/@opencode%2fcli/$version")
  [ "$status" != 200 ] || die "@opencode/cli@$version is already published"
fi

# What each channel builds and publishes.
case "$channel" in
  latest) npm_tag=latest cli=true desktop=true node=false release=true ;;
  dev) npm_tag=dev cli=true desktop=false node=true release=false ;;
  beta) npm_tag="" cli=false desktop=true node=false release=false ;;
  pr) npm_tag=pr cli=true desktop=true node=true release=true ;;
esac
dry_run=false
if [ "$channel" = pr ]; then dry_run=true; fi

{
  echo "version=$version"
  echo "channel=$channel"
  echo "npm_tag=$npm_tag"
  echo "dry_run=$dry_run"
  echo "cli=$cli"
  echo "desktop=$desktop"
  echo "node=$node"
  echo "release=$release"
} | tee -a "$GITHUB_OUTPUT"
