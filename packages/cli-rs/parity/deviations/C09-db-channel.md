# C09: the database name in `debug paths`

TypeScript: `databasePath` names the file after the channel embedded at build time (`version.ts`):
`opencode.db` for `latest`, `dev`, `beta`, `next`, and `prod`, else `opencode-<channel>.db`. A build run from
source has channel `local`, so it prints `opencode-local.db`.

Rust: the same rule, `OPENCODE_DB` and `OPENCODE_DISABLE_CHANNEL_DB` included, but the channel is read at run
time: `OPENCODE_CHANNEL`, else `latest` (plan 6.6). Without the variable it prints `opencode.db`, the
database of a released client.

Reason: the Rust client has no build channel (plan 6.6), and `latest` is the channel whose service and
database it uses by default. The P-CLI scenario `C.1/debug-paths` sets `OPENCODE_DISABLE_CHANNEL_DB=1` so both
sides print `opencode.db`.
