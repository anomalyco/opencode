# Hidden Approval Reproducer

Requires Bun, FFmpeg, and `opencode-drive` v2.0.0. Run from the fix checkout after
`bun install --frozen-lockfile`. The target base checkout also needs its dependencies installed.

```sh
export OPENCODE_DRIVE_MEDIA_DIR="$PWD/.cache/hidden-approval"

# Unmodified base revision in a separate worktree.
OPENCODE_REPRO_BEFORE=1 OPENCODE_DEV=/path/to/base \
  opencode-drive run script/repro/hidden-approval.ts

# Fixed revision.
OPENCODE_DEV="$PWD" opencode-drive run script/repro/hidden-approval.ts
```

Both runs use the same isolated project, simulated model, real `glob` tool, real
permission service, and production TUI. The preload changes only the automatic
cleanup timing: eight seconds instead of one hour, swept every second instead
of every minute. It does not edit either checkout or manually invalidate the cache.

The scenario requests a search, leaves its permission unanswered through cleanup,
closes the TUI, opens the same session in a fresh TUI, and presses Enter. It asserts
the server's permission count, retained request ID, and execution status:

| Checkpoint         | Before               | After                  |
| ------------------ | -------------------- | ---------------------- |
| Initial permission | One request          | One request            |
| After cleanup      | No request           | Same request           |
| Reopened TUI       | Spinner, no approval | Allow once available   |
| After Enter        | Still active         | Search completed, idle |

Each run prints its annotated MP4 path and retains screenshots. The fixture
interrupts its own session afterward; it never connects to the user's live server.

The deterministic unit regression advances 61 virtual minutes and also verifies
that cleanup still occurs after the final borrower releases the location:

```sh
cd packages/core
bun run test test/location-layer.test.ts -t 'keeps borrowed locations discoverable'
```
