# Background completion after parent-location eviction

`subagent-eviction.ts` drives an isolated server and its real TUI. It starts a
background subagent, moves the child to another directory, leaves the parent
idle, evicts and rebuilds the parent location, then lets the child finish.

Only the LLM responses and a `fixture_hold` tool are simulated. Session movement,
job scopes, completion delivery, SQLite persistence, and the parent wake are real.
The existing `DELETE /api/debug/location` endpoint invalidates the same location
graph as inactivity eviction, so the proof does not wait for the 60-minute TTL.
It does not change the server clock or restart the server.

## Run

Use Bun 1.4.2, an available `opencode-drive` 2.1.3 installation on the module path,
and a dependency-installed V2 checkout. The script is an Effect program, run with
`opencode-drive run` (which typechecks before launch).

```sh
OPENCODE_DRIVE_DB=proof.sqlite \
OPENCODE_DRIVE_MEDIA_DIR=$PWD/.drive-output \
DEMO_LABEL=AFTER \
opencode-drive run script/drive/subagent-eviction.ts
```

Run that same script against an immutable base checkout:

```sh
OPENCODE_DEV=/path/to/base-checkout \
OPENCODE_DRIVE_DB=proof.sqlite \
OPENCODE_DRIVE_MEDIA_DIR=$PWD/.drive-output \
DEMO_LABEL=BEFORE \
opencode-drive run script/drive/subagent-eviction.ts
```

`DEMO_LABEL=BEFORE` asserts the known missing wake; `AFTER` asserts successful
delivery. `DEMO_EVICT=false` is a control and must wake even on the base.

The script checks the child's completed answer, counts the parent's synthetic
notifications, and reads only its isolated database's background marker. It
writes `proof.json` inside the reported artifacts directory, saves a screenshot,
and exports an annotated recording. Another location eviction/rebuild must not
duplicate the notification.

| Check                | Base with eviction        | Fixed / no-eviction control |
| -------------------- | ------------------------- | --------------------------- |
| Child completed      | true                      | true                        |
| Parent resumed       | false                     | true                        |
| Parent notifications | 0                         | 1                           |
| Background marker    | completed, unacknowledged | absent                      |

The dynamic hold tool avoids the static adapter loading issue in
[opencode-drive#116](https://github.com/anomalyco/opencode-drive/issues/116).

## History

- `94e3a29d2f` (#34320, June 28): the original V2 subagent tool registered at the
  global application root, so its completion observer shared that lifetime.
- `194b0615e0` (#34619, June 30): plugin-provided tools moved it into the
  location-scoped plugin layer while retaining its captured-scope observer.
- `282b644cde` (#44275, August 22): location expiry became driven by durable
  session activity. A moved child's activity cannot refresh the idle parent's
  original location.
- `7819e7f503` (#47081, September 3): command subagents reused `SubagentJob.make`,
  preserving the same activation-scoped observer in both entry points.

This is source-history attribution of the lifetime mismatch, not a claim that
every historical revision has been executed. The before proof runs V2
`93a7c8404fdc4fdb182eb6bbef7d925cb81e8306`.
