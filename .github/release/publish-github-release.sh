#!/usr/bin/env bash
# publish-github-release.sh <dir>...: attaches the CLI archives and desktop builds in the given artifact dirs, plus
# a SHA256SUMS, to the v<version> GitHub release with OPENCODE_RELEASE_NOTES. Immutable releases lock assets once
# published, so they go to a draft first.
. "$(dirname "$0")/lib.sh"

assets=$(mktemp -d)
for dir in "$@"; do
  find "$dir" -maxdepth 1 -type f \( -name 'opencode-*.zip' -o -name 'opencode-*.tar.gz' -o -name 'opencode-desktop-*' \) \
    ! -name '*.tgz' ! -name '*.app.tar' -exec cp {} "$assets/" \;
done
(cd "$assets" && sha256 -- * > SHA256SUMS && cat SHA256SUMS)
printf '%s\n' "${OPENCODE_RELEASE_NOTES:-}" > "$assets.md"
if dry_run; then exit 0; fi

tag="v$OPENCODE_VERSION"
gh release view "$tag" > /dev/null 2>&1 || gh release create "$tag" --draft --verify-tag --title "$tag" --notes-file "$assets.md"
gh release upload "$tag" "$assets"/* --clobber
gh release edit "$tag" --draft=false
