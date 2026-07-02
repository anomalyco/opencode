---
name: debug-opencode
description: Use when interactively running, debugging, or verifying opencode's own V2 CLI/TUI or server during development in this repo — starting the dev TUI, driving it with termctrl, comparing V2 against the legacy TUI, hitting the V2 server/API directly, reading log files, or attaching Bun's inspector.
---

# Debugging opencode itself

Workflow for interactively exercising the V2 CLI/TUI and server while developing in this repo. All commands below run from `packages/cli` unless noted otherwise.

## Migration context

- The TUI is being ported from legacy APIs to the new V2 APIs. New and migrated TUI behavior should use `sdk.client.v2` and the location-scoped data in `packages/tui/src/context/data.tsx` instead of adding dependencies on legacy sync state.
- Preserve established TUI behavior unless the task intentionally changes it. When behavior, copy, keyboard interaction, or layout is unclear, compare the local V2 TUI with the latest released legacy TUI (see "Comparing V2 against the legacy TUI" below) rather than guessing.

## Server/client model

opencode V2 is a client/server system, not a single monolithic process:

- **Server process** runs the Effect HTTP API (`packages/server`) and owns all domain state: sessions, database, plugins, permissions, Location services. It's started by the `serve` command (`packages/cli/src/commands/handlers/serve.ts`).
- **TUI process** is a separate process that runs no application logic itself — it's an HTTP/SSE client of the server via the generated SDK (`createOpencodeClient` / `sdk.client.v2`).
- **Discovery**: CLI processes find the shared server through a JSON registration file at `~/.local/state/opencode/service.json` (or `service-local.json` for the local/dev channel) containing `{id, version, url, pid}`. A separate password file under `~/.config/opencode/service.json` provides HTTP Basic auth. Before reusing a registration, the client calls `GET /health` to confirm the server is alive, authenticated, and version-compatible.
- **Sharing**: because of this registration/health-check dance, many concurrent `opencode`/TUI invocations converge on one shared background daemon rather than each spawning their own. If no compatible healthy daemon is found, a new one is spawned detached (`serve --service`) and registers itself.
- **`bun dev service start|status|stop|restart`** manages this shared background daemon's lifecycle directly — useful when you need to force a fresh server, confirm one is running, or kill a stuck one.
- **Standalone mode** (`--standalone`) opts a single invocation out of the shared daemon: it spawns a private one-off `serve --stdio --port 0` child tied to that invocation's lifetime, with its own random password. Use this to isolate a debugging session from your other running opencode sessions.
- Every log line is tagged `role=server` or `role=cli` and a per-process `run=<id>`, so you can distinguish server-side and client-side activity in one shared log file (see "Logs" below) even when both roles are interleaved from concurrent processes.

## Starting the dev TUI

- This package is the V2 CLI adapter. Run its `dev` script when testing the TUI; do not use the repository-root `bun dev`, which launches the legacy `packages/opencode` CLI.
- Run commands from `packages/cli`. Use `bun dev` for most debugging so the TUI starts with a private V2 server.

## Interactive debugging with termctrl

- Use `termctrl` for interactive checks instead of starting the TUI as a blocking foreground process. It provides a real PTY, handles OpenTUI's host handshake, and can save reviewable screenshots.
- Use a dedicated session name and do not reuse or kill an unrelated session.

```bash
termctrl start opencode-v2-dev --host opentui --cols 112 --rows 34 -- bun dev
termctrl wait opencode-v2-dev "Ask anything" --timeout 20000
termctrl show opencode-v2-dev
```

- Wait for visible text before interacting instead of relying on fixed sleeps. Use the text expected from the screen under test, such as `Ask anything` or `Connect a provider`.
- Drive the running TUI with `termctrl send`. Prefix typed input with `text:` and send control keys separately so the interaction matches real terminal input.

```bash
termctrl send opencode-v2-dev 'text:example prompt' enter
termctrl send opencode-v2-dev ctrl-c
```

- Use `termctrl show` after each meaningful interaction and inspect the full visible screen for rendering errors, stale state, error toasts, and unexpected exits.
- Save PNG evidence for every user-visible bug and fix. Do not save text captures; inspect the rendered PNG. Write temporary captures outside the repository unless the artifact is intended to be committed.

```bash
termctrl save opencode-v2-dev --format png --out /tmp/opencode/v2-tui.png
```

- For resize-sensitive changes, resize the viewport, wait for the expected content, and capture the screen again:

```bash
termctrl resize opencode-v2-dev --cols 100 --rows 30
termctrl show opencode-v2-dev
```

- Source changes may require restarting the process. Use `termctrl restart opencode-v2-dev` rather than assuming the running TUI reloaded the change.
- To exercise background-service behavior, use `bun dev service start`, `bun dev service status`, and `bun dev service stop`.
- Always clean up the Terminal Control session when the check is complete:

```bash
termctrl stop opencode-v2-dev
```

## Comparing V2 against the legacy TUI

Run both versions in separate Terminal Control sessions and save PNG-only captures at equivalent states:

```bash
# From packages/cli: local V2 TUI
termctrl start opencode-v2-dev --host opentui --cols 112 --rows 34 -- bun dev

# Released legacy TUI behavior reference
termctrl start opencode-legacy --host opentui --cols 112 --rows 34 -- bunx opencode-ai@latest

termctrl save opencode-v2-dev --format png --out /tmp/opencode/v2.png
termctrl save opencode-legacy --format png --out /tmp/opencode/legacy.png
```

- Use the same viewport and send equivalent inputs to both sessions before comparing screenshots. The released CLI is a behavioral reference, not a source of V2 API design; keep the local implementation on V2 endpoints.
- Stop both sessions after comparison: `termctrl stop opencode-v2-dev` and `termctrl stop opencode-legacy`.

## Server/API debugging

- Use `bun dev api --help` from `packages/cli` to inspect the API debugging command. It sends one request to the V2 server using the same daemon discovery/auth path as the CLI.
- Use `bun dev api` to introspect the server-side data backing the TUI. This is useful when debugging UI bugs: compare what the screen renders with the raw session, message, event, agent, or health data returned by the API to determine whether the bug is in the server state, the client data layer, or the TUI rendering.
- `bun dev api` accepts either an OpenAPI operation ID or a raw HTTP method plus path:

```bash
bun dev api get /health
bun dev api get /openapi.json
bun dev api <operationId> --param key=value
```

- Pass JSON request bodies with `--data`/`-d`; the command sets `content-type: application/json` automatically unless you provide a header. Add extra headers with `--header`/`-H name:value`.
- If no compatible background server is registered, `bun dev api` starts one through the daemon service. Use `bun dev service status`, `bun dev service restart`, and `bun dev service stop` when you need explicit lifecycle control.
- Prefer raw method/path calls for quick server debugging and operation IDs when exercising documented OpenAPI routes with path or query parameters.

## Logs

- Log files live under `~/.local/share/opencode/log/`. In a local/dev checkout the active file is `opencode-local.log`; `opencode.log` is used for non-local (released) channel installs. Both are append-only, shared across every CLI and server process on the machine.
- Each line is structured `key=value` text: `timestamp`, `level`, `run=<id>` (per-process run ID), `message`, and a `role=cli` or `role=server` tag. Use `run=` to isolate one process's activity and `role=` to separate client-side from server-side log lines, since a shared daemon interleaves many processes' output in one file.
- Tail the live file while reproducing an issue instead of guessing from stale output:

```bash
tail -f ~/.local/share/opencode/log/opencode-local.log
```

- Filter to one run or role when the file is noisy:

```bash
grep 'run=8fc3b1d5' ~/.local/share/opencode/log/opencode-local.log
grep 'role=server' ~/.local/share/opencode/log/opencode-local.log
```

- `OPENCODE_LOG_LEVEL` controls verbosity (default `INFO`); set it before starting `bun dev` or `serve` to get `DEBUG` output for a specific repro.
- `OPENCODE_PRINT_LOGS=1` additionally tees log output to stderr of the process that emitted it, which is useful when a process fails before you'd think to check the shared log file.
- `termctrl logs <session>` surfaces stdout/stderr for a Terminal Control session specifically (e.g. inspector output or startup failures before the TUI renderer starts) — use the log file above for anything emitted by a separate server/daemon process instead.

## Debugger

- To debug the V2 CLI or TUI with Bun's inspector, launch the CLI entrypoint through Terminal Control with an inspector URL, then attach a debugger to that URL:

```bash
termctrl start opencode-v2-debug --host opentui --cols 112 --rows 34 -- \
  bun run --inspect=ws://localhost:6499/ src/index.ts
```

- Use `--inspect-wait` or `--inspect-brk` when execution must pause until the debugger attaches.
- Use `termctrl logs opencode-v2-debug` for inspector output or startup failures emitted before the TUI renderer starts. Use `termctrl show` for the visible full-screen TUI.

## Verification

- Run `bun typecheck` from `packages/cli` after CLI adapter changes.
- Run `bun typecheck` and `bun test` from `packages/tui` after shared TUI changes. Do not run tests from the repository root.
- Treat automated checks and Terminal Control smoke tests as complementary. For user-visible changes, verify initial render, the changed interaction, Ctrl-C exit behavior, and save a screenshot of the corrected state.
