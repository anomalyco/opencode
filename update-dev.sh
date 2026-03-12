#!/usr/bin/env bash
# update-dev.sh - Keep dev-brendan branch = upstream/dev + your open PRs
# PRs are auto-discovered via gh cli from the anomalyco org fork on sst/opencode
set -euo pipefail

BRANCH="dev-brendan"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="dev"
UPSTREAM_REPO="sst/opencode"
# PRs come from the org fork; filter by headRepositoryOwner
PR_OWNER="anomalyco"

echo "==> Fetching upstream/$UPSTREAM_BRANCH..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

echo "==> Discovering open PRs from $PR_OWNER on $UPSTREAM_REPO..."
MY_PRS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && MY_PRS+=("$line")
done < <(gh pr list --repo "$UPSTREAM_REPO" --state open --json number,title,headRepositoryOwner,isDraft \
  | jq -r --arg owner "$PR_OWNER" \
    '.[] | select(
      .headRepositoryOwner.login == $owner and
      .isDraft == false and
      (.title | ascii_downcase | startswith("wip") | not)
    ) | "\(.number)  # \(.title)"')

if [[ ${#MY_PRS[@]} -eq 0 ]]; then
  echo "    No open PRs found."
else
  for entry in "${MY_PRS[@]}"; do
    echo "    PR #$entry"
  done
fi

echo "==> Fetching PR refs and collecting commits..."
PR_REFS=()
for entry in "${MY_PRS[@]+"${MY_PRS[@]}"}"; do
  pr="${entry%%[[:space:]]*}"
  ref="pr-$pr"
  git fetch "$UPSTREAM_REMOTE" "pull/$pr/head:$ref" --force
  commits=$(git log --reverse --format="%H" "upstream/$UPSTREAM_BRANCH".."$ref")
  if [[ -z "$commits" ]]; then
    echo "    PR #$pr: all commits already merged upstream, skipping"
  else
    count=$(echo "$commits" | wc -l | tr -d ' ')
    echo "    PR #$pr: $count commit(s) to consider"
    PR_REFS+=("$ref")
  fi
done

echo "==> Switching to $BRANCH and resetting to upstream/$UPSTREAM_BRANCH..."
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
git reset --hard "upstream/$UPSTREAM_BRANCH"

if [[ ${#PR_REFS[@]} -eq 0 ]]; then
  echo "    Nothing to cherry-pick."
else
  # Collect all unique commits across all PRs in topological order
  # (git log --topo-order --reverse across all PR refs, excluding upstream)
  TOPO_ARGS=()
  for ref in "${PR_REFS[@]}"; do
    TOPO_ARGS+=("$ref")
  done
  TOPO_ARGS+=("^upstream/$UPSTREAM_BRANCH")

  ALL_COMMITS=()
  SEEN_SHAS=()
  while IFS= read -r sha; do
    [[ -z "$sha" ]] && continue
    already=false
    for seen in "${SEEN_SHAS[@]+"${SEEN_SHAS[@]}"}"; do
      [[ "$seen" == "$sha" ]] && already=true && break
    done
    if ! $already; then
      SEEN_SHAS+=("$sha")
      ALL_COMMITS+=("$sha")
    fi
  done < <(git log --reverse --topo-order --format="%H" "${TOPO_ARGS[@]}")

  echo "==> Cherry-picking ${#ALL_COMMITS[@]} unique commit(s)..."
  for sha in "${ALL_COMMITS[@]+"${ALL_COMMITS[@]}"}"; do
    msg=$(git log --format="%s" -1 "$sha")
    result=$(git cherry-pick "$sha" 2>&1) && {
      echo "    Applied: $msg"
    } || {
      if echo "$result" | grep -qE "empty|nothing to commit"; then
        git cherry-pick --skip
        echo "    Skipped (already in upstream): $msg"
      elif echo "$result" | grep -q "CONFLICT"; then
        git cherry-pick --skip
        echo "    Skipped (superseded by upstream): $msg"
        echo "    WARNING: verify this is expected (upstream may have merged it differently)"
      else
        echo "ERROR: cherry-pick failed for: $msg ($sha)"
        echo "$result"
        echo "Resolve conflicts and run: git cherry-pick --continue"
        exit 1
      fi
    }
  done
fi

echo "==> Installing dependencies..."
bun install

echo "==> Committing branch maintenance files..."
cat > MAINTENANCE.md << 'MDEOF'
# dev-brendan branch

This branch is a personal build maintained by [@brendandebeasi](https://github.com/brendandebeasi).

It tracks `upstream/dev` (sst/opencode) with open PRs from the anomalyco org
cherry-picked on top. It is rebuilt automatically and should never be submitted
as a PR to sst/opencode or anomalyco/opencode.

## Updating

```bash
bash update-dev.sh
```

This fetches the latest upstream/dev, auto-discovers open PRs from anomalyco on
sst/opencode (skipping drafts and WIP), applies unique commits in topological
order, installs deps, and force-pushes to brendandebeasi/opencode.

## Adding a PR

PRs are discovered automatically via `gh pr list`. To track a specific PR that
wouldn't be auto-discovered, edit the override section in `update-dev.sh`.
MDEOF
git add update-dev.sh MAINTENANCE.md
git commit --no-verify -m "chore(dev-brendan): branch maintenance scripts [skip ci]"

echo "==> Pushing to fork (brendandebeasi/opencode)..."
git push fork "$BRANCH" --force-with-lease 2>&1 || {
  echo "    Push failed - run manually: git push fork $BRANCH --force"
}

echo ""
echo "Done! $BRANCH is now at upstream/$UPSTREAM_BRANCH + your PRs."
git log --oneline "upstream/$UPSTREAM_BRANCH"..HEAD
