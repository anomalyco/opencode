# T08: the DevTools bar follows the run-time channel

TypeScript: the DevTools bar (`✓ Server  ○ UI  Theme  Tools  Experiments`) shows when `debug.devtools` is on, or,
when the config does not set it, on the `local` channel (`packages/tui/src/app.tsx:496`). The channel is embedded
at build time (`packages/cli/src/version.ts`); a CLI run from source has none, so it is `local` and draws the bar. A
release build is `latest` (or `beta`, `next`, ...) and draws none.

Rust: the same rule (`crates/tui/src/features/devtools.rs`), but the channel is read at run time:
`OPENCODE_CHANNEL`, else `latest` (`C09-db-channel`). Without the variable Rust draws no bar, as a released TS client
does; with `OPENCODE_CHANNEL=local` it draws the bar the TS CLI from source draws.

Driven: `parity/scenarios/E.18a/channel.pty.ts` runs the home screen with no `debug.devtools` against the TS CLI
from source. TS shows the bar on the last row and moves the version row up one (3 lines). `E.18a/channel-local.pty.ts`
sets `OPENCODE_CHANNEL=local`, and both clients are equal. The plugins field test saw the bar in every TS capture
and in none of Rust's.

Reason: the Rust client has no build channel, and `latest` is the channel whose service, database and
defaults it uses. A Rust build cannot tell a run from source from a release, so it follows the release.
