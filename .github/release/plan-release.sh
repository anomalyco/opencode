#!/usr/bin/env bash
# plan-release.sh: decides version, channel and npm dist-tag from the event, ref and dispatch inputs
# (INPUT_BUMP, INPUT_VERSION, INPUT_CHANNEL) only, and writes them to $GITHUB_OUTPUT. Nothing here reads repository files.
#
#   push or dispatch on dev           -> dev      0.0.0-dev-<run>     npm tag dev, desktop
#   dispatch on dev with bump/version -> latest   x.y.z               npm tag latest, releasers only, notes required
#   dispatch on dev with channel=beta -> beta     0.0.0-beta-<run>    desktop only, release=true
#   push or dispatch on beta          -> beta     0.0.0-beta-<run>    desktop only, release=true
#   push on refs/tags/v*              -> latest/beta from tag         version from tag, release=true
#   pull_request                      -> pr       0.0.0-pr-<run>      everything, dry run
#
# Releasers are actors with the admin or maintain role on the repository (the releasers team has maintain).
. "$(dirname "$0")/lib.sh"

# Resolve channel from the event, ref and inputs.
if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  # Tag push: version comes from the tag. Stable = latest channel; pre-release = beta channel.
  channel="${GITHUB_REF#refs/tags/v}"
  [[ "$channel" == *-* ]] && channel="beta" || channel="latest"
elif [ "$GITHUB_REF" = "refs/heads/dev" ]; then
  if [ "${INPUT_CHANNEL:-}" = "beta" ]; then
    channel="beta"
  elif [ -n "${INPUT_BUMP:-}" ] || [ -n "${INPUT_VERSION:-}" ]; then
    channel="latest"
  else
    channel="dev"
  fi
elif [ "$GITHUB_REF" = "refs/heads/beta" ]; then
  channel="beta"
else
  case "$GITHUB_EVENT_NAME" in
    pull_request) channel="pr" ;;
    *) die "$GITHUB_EVENT_NAME on $GITHUB_REF cannot publish" ;;
  esac
fi

if [ "$channel" = latest ] && [ -z "${INPUT_RELEASE_NOTES//[[:space:]]/}" ]; then
  die "Stable releases need release notes; generate them with ./script/release.ts --print"
fi

# Stable releases from dispatch require a releaser; tag pushes are permissionless (the tag push itself is authorization).
if [ "$channel" = latest ] && [ "$GITHUB_REF" != refs/tags/v* ]; then
  actor=${GITHUB_TRIGGERING_ACTOR:-${GITHUB_ACTOR:-}}
  [ -n "$actor" ] || die "Stable releases can only be started by releasers; the triggering actor is unknown"
  role=$(gh api "repos/$GITHUB_REPOSITORY/collaborators/$actor/permission" --jq .role_name) || role=""
  case "$role" in
    admin | maintain) ;;
    *) die "Stable releases can only be started by releasers (admin or maintain on the repo); $actor has ${role:-no readable role}" ;;
  esac
fi

if [ "$channel" = latest ] && [ -n "${INPUT_VERSION:-}" ]; then
  version=$INPUT_VERSION
elif [ "$channel" = latest ] && [[ "$GITHUB_REF" != refs/tags/v* ]]; then
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
  if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
    version="${GITHUB_REF#refs/tags/v}"
  else
    version="0.0.0-$channel-$GITHUB_RUN_NUMBER"
    if [ "$GITHUB_RUN_ATTEMPT" != 1 ]; then version="$version.$GITHUB_RUN_ATTEMPT"; fi
  fi
fi

if [ "$channel" = latest ] && [ -n "${INPUT_VERSION:-}" ]; then
  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || [[ "$version" == 0.0.0-* ]]; then
    die "Invalid release version: $version"
  fi
  status=$(curl -sS -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/@opencode%2fcli/$version")
  [ "$status" != 200 ] || die "@opencode/cli@$version is already published"
fi

# What each channel builds and publishes.
case "$channel" in
  latest) npm_tag=latest cli=true desktop=true node=false release=true ;;
  dev) npm_tag=dev cli=true desktop=true node=true release=false ;;
  beta) npm_tag="" cli=false desktop=true node=false release=true ;;
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
