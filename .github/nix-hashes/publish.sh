#!/usr/bin/env bash
# publish.sh <hashes.json>: run from a checkout of dev. Puts <hashes.json> on bot/nix-hashes as one commit on top of dev,
# opens or updates the pull request into dev, dispatches its required checks and enables auto-merge. Closes the pull
# request instead when dev already has these hashes. Uses git, gh and jq only; never runs repository code.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
new=$(realpath "$1")
branch=bot/nix-hashes
file=nix/hashes.json
title="chore: update nix node_modules hashes"
: "${GH_REPO:?}" "${GITHUB_SHA:?}"
git=(git -c core.hooksPath=/dev/null -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com')

bash "$here/validate.sh" "$new"

"${git[@]}" fetch --no-tags --depth=1 origin "+refs/heads/dev:refs/remotes/origin/dev" "$GITHUB_SHA"

# A newer push that changed the inputs has its own run, which publishes hashes for it. Mirrors on.push.paths.
if ! git diff --quiet "$GITHUB_SHA" origin/dev -- bun.lock package.json ':(glob)packages/*/package.json' \
  ':(glob)services/*/package.json' flake.lock nix/node_modules.nix nix/scripts patches; then
  echo "::notice::dev changed the hash inputs since $GITHUB_SHA; leaving it to the newer run"
  exit 0
fi

# Only a same-repository pull request is the bot's; a fork can use the same branch name.
find_pr() {
  gh pr list --repo "$GH_REPO" --base dev --head "$branch" --state open --json number,isCrossRepository \
    --jq 'map(select(.isCrossRepository | not)) | .[0].number // empty'
}
pr=$(find_pr)

"${git[@]}" checkout -B "$branch" origin/dev
if cmp -s "$new" "$file"; then
  echo "dev already has these hashes"
  if [ -n "$pr" ]; then
    gh pr close "$pr" --repo "$GH_REPO" --delete-branch --comment "dev already has these hashes."
  fi
  exit 0
fi

cp "$new" "$file"
bash "$here/validate.sh" "$file"
"${git[@]}" add -- "$file"
"${git[@]}" commit --no-verify -m "$title"
[ "$(git diff --name-only origin/dev HEAD)" = "$file" ] || {
  echo "::error::the commit changes more than $file" >&2
  exit 1
}
"${git[@]}" push --no-verify --force origin "HEAD:refs/heads/$branch"

if [ -z "$pr" ]; then
  gh pr create --repo "$GH_REPO" --base dev --head "$branch" --title "$title" \
    --body "Updates \`$file\` to the node_modules hashes computed for $GITHUB_SHA by bot-nix-hashes. check-bot-scope keeps this branch to that file."
  pr=$(find_pr)
fi

# Pushes and pull requests made with GITHUB_TOKEN start no workflows; dispatches do. These produce the checks dev
# requires on the new head.
for workflow in check.yml check-test.yml check-bot-scope.yml; do
  gh workflow run "$workflow" --repo "$GH_REPO" --ref "$branch"
done

gh pr merge "$pr" --repo "$GH_REPO" --auto --squash
echo "### Nix hashes" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Updated pull request #$pr" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
