#!/usr/bin/env bash
# tag-release.sh: in a checkout of the dispatched dev commit, commits the release versions and changelog
# (OPENCODE_RELEASE_NOTES) and pushes only the v<version> tag at it. Writes sha=<commit> to $GITHUB_OUTPUT.
# Runs git only, with hooks disabled; no repository code.
. "$(dirname "$0")/lib.sh"

tag="v$OPENCODE_VERSION"
if ! dry_run; then
  umask 077
  ssh_dir=$(mktemp -d)
  trap 'rm -rf "$ssh_dir"' EXIT
  printf '%s\n' "$RELEASE_TAG_KEY" > "$ssh_dir/key"
  unset RELEASE_TAG_KEY
  echo 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' > "$ssh_dir/known_hosts"
  export GIT_SSH_COMMAND="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
  git remote set-url origin git@github.com:anomalyco/opencode.git
fi
# @opencode/pty is versioned separately, by process-daemon-v<version> tags.
git ls-files -z -- '*package.json' bun.lock ':!packages/process-daemon/**' | xargs -0 sed -i -E "s/\"version\": \"[^\"]+\"/\"version\": \"$OPENCODE_VERSION\"/g"

if [ -n "${OPENCODE_RELEASE_NOTES:-}" ] && ! grep -qF -x "## $tag" CHANGELOG.md && ! grep -qF "## $tag " CHANGELOG.md; then
  notes=$(mktemp)
  printf '%s\n' "$OPENCODE_RELEASE_NOTES" > "$notes"
  awk -v entry="## $tag — $(date -u +%F)" -v notes="$notes" '
    function emit() { print entry; print ""; while ((getline line < notes) > 0) print line; print ""; done = 1 }
    !done && /^## / { emit() }
    { print }
    END { if (!done) { print ""; emit() } }
  ' CHANGELOG.md > "$notes.md"
  mv "$notes.md" CHANGELOG.md
fi

if git diff --name-only | grep -vE '(^|/)package\.json$|^bun\.lock$|^CHANGELOG\.md$'; then
  die "The release commit may only change versions and the changelog"
fi

git -c core.hooksPath=/dev/null \
  -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit --no-verify -q -am "release: $tag"

# A rerun reuses the tag when it holds the same tree.
existing=$(git ls-remote origin "refs/tags/$tag" | cut -f1)
if [ -n "$existing" ]; then
  git fetch -q --depth=1 origin "refs/tags/$tag"
  [ "$(git rev-parse "$existing^{tree}")" = "$(git rev-parse "HEAD^{tree}")" ] || die "Tag $tag already exists with different contents"
  echo "sha=$existing" >> "$GITHUB_OUTPUT"
  exit 0
fi
if ! dry_run; then git push -q origin "HEAD:refs/tags/$tag"; fi
echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
