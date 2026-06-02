# Personal Fork Changelog

Changes specific to `c0dn/opencode-personal`, layered on top of upstream
`anomalyco/opencode`. Upstream features are tracked by upstream; this file only
records the personal patch stack and personal feature additions.

Versioning note: automated upstream mirrors are published as
`v<upstream-version>-c0dn.N`, and manual personal builds use
`<upstream-version>-c0dn.N`. Releases are built manually via
`personal-release.yml` and are Linux-only (`linux-x64`, `linux-arm64`).

## Unreleased

### Added
- TUI: `/tps` slash command (alias `/tokens-per-second`) that toggles a compact
  tokens-per-second indicator in the prompt footer. State persists via the
  `tps_display_visibility` KV key. Shows a live average while a response streams
  and keeps the final average after completion. TPS is computed as
  `(output + reasoning tokens) / generation seconds`, with a character-based `~`
  estimate fallback before provider token counts are available.
- Web (v2 UI): assistant message metrics popover. A help icon in the assistant
  message metadata row opens a compact panel showing average TPS
  (output + reasoning), latency, time to first token, generation time, token
  breakdown, cost, provider, model, agent, and finish/interrupted state. Fully
  client-side from existing sync data; no server/API/schema changes.
- Web (v2 UI): shared `Popover` gained backwards-compatible
  `onOpenAutoFocus`, `onCloseAutoFocus`, and `contentProps` so hover-open
  surfaces do not steal focus from the composer and can stay open while the
  pointer is over the content.

## Baseline personal patches

These are the standing customizations that define this fork's release channel.
They are maintained across upstream syncs.

### Release channel
- CLI updater and installer pull from GitHub Releases of
  `c0dn/opencode-personal`.
- Package-manager upgrades (`npm`, `bun`, `pnpm`, `brew`, `scoop`, `choco`) are
  blocked for personal builds; only GitHub-release/curl upgrades are supported.
- Personal release builds are limited to `linux-x64` and `linux-arm64`.
- `OPENCODE_BUILD_TARGETS` filters CLI build targets.

### Automation
- `sync-upstream.yml` merges `anomalyco/opencode:dev` into this fork's `dev`,
  runs typecheck/tests, and mirrors the latest upstream release as
  `v<upstream-version>-c0dn.1` when the upstream tag is contained in `dev`.
- `personal-release.yml` publishes manual Linux CLI builds and can be called by
  the upstream sync after a successful merge.
