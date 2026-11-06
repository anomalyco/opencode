#!/usr/bin/env bash
# publish-winget.sh <manifests dir>: opens a microsoft/winget-pkgs pull request for each package render-winget.sh wrote,
# from the fork of the WINGET_GITHUB_TOKEN owner, the only way to contribute there. Only stable releases are submitted.
. "$(dirname "$0")/lib.sh"

if [ "$OPENCODE_CHANNEL" != latest ]; then
  echo "skipped WinGet submission: $OPENCODE_CHANNEL is not a stable release"
  exit 0
fi
if dry_run; then
  echo "dry-run: skipped WinGet submission"
  exit 0
fi
test -n "${WINGET_GITHUB_TOKEN:-}" || die "Missing WINGET_GITHUB_TOKEN"
export GH_TOKEN=$WINGET_GITHUB_TOKEN

upstream=microsoft/winget-pkgs
fork=$(gh api -X POST "repos/$upstream/forks" -F default_branch_only=true --jq .full_name)
for dir in "$1"/*/; do
  id=$(basename "$dir")
  folder="manifests/a/${id//.//}/$OPENCODE_VERSION"
  branch="$id-$OPENCODE_VERSION"
  title="New version: $id version $OPENCODE_VERSION"
  if gh api "repos/$upstream/contents/$folder" --silent 2> /dev/null; then
    echo "$id $OPENCODE_VERSION is already in $upstream"
    continue
  fi
  if [ "$(gh api "repos/$upstream/pulls?state=all&head=${fork%%/*}:$branch" --jq length)" != 0 ]; then
    echo "$id $OPENCODE_VERSION already has a pull request"
    continue
  fi
  # Forks share objects with their upstream, so the branch can start from upstream master without syncing the fork.
  head=$(gh api "repos/$upstream/git/ref/heads/master" --jq .object.sha)
  tree=$(
    for file in "$dir"*.yaml; do
      jq -n --arg path "$folder/$(basename "$file")" --rawfile content "$file" \
        '{path: $path, mode: "100644", type: "blob", content: $content}'
    done | jq -s --arg base "$(gh api "repos/$upstream/git/commits/$head" --jq .tree.sha)" '{base_tree: $base, tree: .}' |
      gh api -X POST "repos/$fork/git/trees" --input - --jq .sha
  )
  commit=$(jq -n --arg message "$title" --arg tree "$tree" --arg parent "$head" \
    '{message: $message, tree: $tree, parents: [$parent]}' | gh api -X POST "repos/$fork/git/commits" --input - --jq .sha)
  # A retried release can find the branch from an attempt that failed before opening its pull request.
  gh api -X POST "repos/$fork/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" --silent 2> /dev/null ||
    gh api -X PATCH "repos/$fork/git/refs/heads/$branch" -f sha="$commit" -F force=true --silent
  gh api -X POST "repos/$upstream/pulls" -f title="$title" -f head="${fork%%/*}:$branch" -f base=master \
    -f body="Published by the [OpenCode](https://github.com/anomalyco/opencode) release workflow in $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID." \
    --jq '"Opened \(.html_url)"'
done
