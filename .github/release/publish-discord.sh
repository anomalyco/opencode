#!/usr/bin/env bash
# publish-discord.sh: announces the v<version> release in Discord with OPENCODE_RELEASE_NOTES (DISCORD_WEBHOOK).
# Discord caps an embed description at 4096 characters, so longer notes are cut and link to the GitHub release.
. "$(dirname "$0")/lib.sh"

tag="v$OPENCODE_VERSION"
payload=$(jq -n --arg tag "$tag" --arg notes "${OPENCODE_RELEASE_NOTES:-}" \
  --arg url "https://github.com/$GITHUB_REPOSITORY/releases/tag/$tag" '
  ($notes | if length > 4000 then .[:4000] + "\n\n[Full release notes](\($url))" else . end) as $description |
  {
    allowed_mentions: {parse: []},
    embeds: [{title: "OpenCode V2 \($tag)", url: $url, color: 2829099} + if $description == "" then {} else {description: $description} end]
  }')
echo "$payload" | jq .
if dry_run; then exit 0; fi

test -n "${DISCORD_WEBHOOK:-}" || die "DISCORD_WEBHOOK is not set"
curl -fsS --retry 3 -H "Content-Type: application/json" -d "$payload" "$DISCORD_WEBHOOK"
