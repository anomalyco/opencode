#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
[[ $GITHUB_REF == refs/heads/v1 ]] || die 'Expected branch v1'
# A rerun must use the same version for every artifact and npm package. Keep
# the timestamp-shaped numeric component used by the existing dev dist-tag.
created=$(gh api "repos/anomalyco/opencode/actions/runs/$GITHUB_RUN_ID" --jq .created_at)
version="0.0.0-dev-$(date -u -d "$created" +%Y%m%d%H%M)-$GITHUB_RUN_ID"
channel=dev
if [[ -n ${INPUT_VERSION:-}${INPUT_BUMP:-} ]]; then
  [[ $GITHUB_EVENT_NAME == workflow_dispatch ]] || die 'Versioned release requires a dispatch'
  case ${GITHUB_TRIGGERING_ACTOR:-$GITHUB_ACTOR} in thdxr|Hona|rekram1-node) ;; *) die 'A releaser must start this dispatch' ;; esac
  channel=latest
  if [[ -n ${INPUT_VERSION:-} ]]; then
    version=$INPUT_VERSION
  else
    current=$(curl -fsS https://registry.npmjs.org/opencode-ai/latest | jq -er .version)
    [[ $current =~ ^1\.([0-9]+)\.([0-9]+)$ ]] || die 'Unexpected latest v1 version'
    minor=${BASH_REMATCH[1]} patch=${BASH_REMATCH[2]}
    case $INPUT_BUMP in
      minor) version="1.$((minor + 1)).0" ;;
      patch) version="1.$minor.$((patch + 1))" ;;
      *) die 'Only 1.x versions can be published from v1' ;;
    esac
  fi
  [[ $version =~ ^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die 'Expected a stable 1.x version'
fi
printf 'version=%s\nchannel=%s\n' "$version" "$channel" >> "$GITHUB_OUTPUT"
