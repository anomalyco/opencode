---
name: opencode-dev
description: Use when interactively running, debugging, or verifying opencode's own CLI/TUI or server during development in this repo — starting the dev TUI, driving it with termctrl, hitting the server/API directly, reading log files, or attaching Bun's inspector.
---

# Debugging opencode itself

Workflow for interactively exercising the CLI/TUI and server while developing in this repo. All commands below run from `packages/cli` unless noted otherwise.

## Server/client model

opencode is a client/server system, not a single monolithic process:

- **Server process** runs the Effect HTTP API (`packages/server`) and owns all domain state: sessions, database, plugins, permissions, Location services. It's started by the `serve` command (`packages/cli/src/commands/handlers/serve.ts`).
- **TUI process** is a separate process that runs no application logic itself — it's an HTTP/SSE client of the server via `@opencode/client` (`OpenCode.make`).
- **Discovery**: CLI processes find the shared server through a JSON registration file at `~/.local/state/opencode/service.json` (or `service-local.json` for the local/dev channel) containing `{id, version, url, pid, password}`; the password is used for HTTP Basic auth. Before reusing a registration, the client calls `GET /api/info` to confirm the server is alive, is the registered PID, and is version-compatible. `opencode service status` prints the registered URL.
- **Sharing**: because of this registration/health-check dance, many concurrent `opencode`/TUI invocations converge on one shared background daemon rather than each spawning their own. If no compatible healthy daemon is found, a new one is spawned detached (`serve --service`) and registers itself.
- **`bun dev service start|status|stop|restart`** manages this shared background daemon's lifecycle directly — useful when you need to force a fresh server, confirm one is running, or kill a stuck one.
- **Standalone mode** (`--standalone`) opts a single invocation out of the shared daemon: it spawns a private one-off `serve --stdio --port 0` child tied to that invocation's lifetime, with its own random password. Use this to isolate a debugging session from your other running opencode sessions.
- Every log line is tagged `role=server` or `role=cli` and a per-process `run=<id>`, so you can distinguish server-side and client-side activity in one shared log file (see "Logs" below) even when both roles are interleaved from concurrent processes.

## Starting the dev TUI

- `packages/cli` is the CLI and TUI entrypoint. `bun dev` from `packages/cli` and the repository-root `bun dev` both run `packages/cli/src/index.ts`.
- `bun dev` connects to the shared local-channel background service (`service-local.json`), starting it if needed. Every worktree on the machine shares that service. Add `--standalone` for a private server tied to this one process.
- Use `bun run dev:live` from the repository root to run this worktree's TUI against the installed `opencode` background server and your real sessions.

## Interactive debugging with termctrl

- Use `termctrl` for interactive checks instead of starting the TUI as a blocking foreground process. It provides a real PTY, handles OpenTUI's host handshake, and can save reviewable screenshots.
- Use a dedicated session name and do not reuse or kill an unrelated session.

```bash
termctrl start opencode-dev --host opentui --cols 112 --rows 34 -- bun dev
termctrl wait opencode-dev "Ask anything" --timeout 20000
termctrl show opencode-dev
```

- Wait for visible text before interacting instead of relying on fixed sleeps. Use the text expected from the screen under test, such as `Ask anything` or `Connect a provider`.
- Drive the running TUI with `termctrl send`. Prefix typed input with `text:` and send control keys separately so the interaction matches real terminal input.

```bash
termctrl send opencode-dev 'text:example prompt' enter
termctrl send opencode-dev ctrl-c
```

- Use `termctrl show` after each meaningful interaction and inspect the full visible screen for rendering errors, stale state, error toasts, and unexpected exits.
- Save PNG evidence for every user-visible bug and fix. Do not save text captures; inspect the rendered PNG. Write temporary captures outside the repository unless the artifact is intended to be committed.

```bash
termctrl save opencode-dev --format png --out /tmp/opencode/tui.png
```

- For resize-sensitive changes, resize the viewport, wait for the expected content, and capture the screen again:

```bash
termctrl resize opencode-dev --cols 100 --rows 30
termctrl show opencode-dev
```

- Source changes may require restarting the process. Use `termctrl restart opencode-dev` rather than assuming the running TUI reloaded the change. Restarting the TUI does not restart the shared background service, so run `bun dev service restart` after server-side changes, or use `--standalone`.
- To exercise background-service behavior, use `bun dev service start`, `bun dev service status`, and `bun dev service stop`.
- Always clean up the Terminal Control session when the check is complete:

```bash
termctrl stop opencode-dev
```

## Server/API debugging

- Use `bun dev api --help` from `packages/cli` to inspect the API debugging command. It sends one request to the server using the same daemon discovery/auth path as the CLI.
- Use `bun dev api` to introspect the server-side data backing the TUI. This is useful when debugging UI bugs: compare what the screen renders with the raw session, message, event, agent, or health data returned by the API to determine whether the bug is in the server state, the client data layer, or the TUI rendering.
- `bun dev api` accepts either an OpenAPI operation ID or a raw HTTP method plus path:

```bash
bun dev api get /api/info
bun dev api get /openapi.json
bun dev api <operationId> --param key=value
```

- Pass JSON request bodies with `--data`/`-d`; the command sets `content-type: application/json` automatically unless you provide a header. Add extra headers with `--header`/`-H name:value`.
- If no compatible background server is registered, `bun dev api` starts one through the daemon service. Use `bun dev service status`, `bun dev service restart`, and `bun dev service stop` when you need explicit lifecycle control.
- Prefer raw method/path calls for quick server debugging and operation IDs when exercising documented OpenAPI routes with path or query parameters.

## Auditing installed `opencode` sessions

Installed (released) sessions use `~/.local/share/opencode/opencode.db` and `~/.local/share/opencode/log/opencode.log`. A local/dev checkout uses `opencode-local.db` and `opencode-local.log` instead, and `OPENCODE_DB` overrides the database. Run `opencode service status` before `opencode api`, because `opencode api` starts a server when none is healthy.

For a supplied `ses_...` ID, compare three sources:

- `opencode api get /api/session/active` and the Session/message endpoints for live server state.
- The database's ordered `event` rows for durable history.
- `packages/tui/src/context/data.tsx` and the relevant route for client projection and rendering.

Locate an uncertain database without modifying it:

```bash
SESSION=ses_...
for db in ~/.local/share/opencode/*.db; do
  sqlite3 "file:$db?mode=ro" "select 1 from session where id='$SESSION' limit 1" 2>/dev/null | grep -q 1 && printf '%s\n' "$db"
done
```

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

## Heap snapshots

On every platform, including Windows, capture the running background server without restarting it or attaching an inspector:

```bash
opencode debug heap-dump
```

It discovers the already-running service (never starts or replaces one), calls `POST /api/debug/heap-dump`, waits until the file is complete, and prints its server-local path. Pass `--server <url>` (with `OPENCODE_PASSWORD`) for a server started with `serve`, and `--directory <dir>` to write somewhere other than the server's log directory (the server creates it; a server that predates the option ignores it and the CLI warns). A 404 means the running server predates the endpoint.

For desktop memory, run **Capture heap snapshots** from the desktop command palette (`packages/gui-extensions/src/debug/main.ts`). It writes `~/Downloads/opencode-heap-<time>/` with the desktop's own (local) server, which writes straight into the folder, every app window renderer, and the Electron main process. Heap snapshots only hold GC-managed objects, so it also records Chromium's memory-infra dump (`memory-infra.json`, open in Perfetto) and summarizes it per process and allocator in `memory.json` (MiB: `malloc`, `partition_alloc`, `cc/tile_memory`, `gpu`, `v8`, …), next to each window's DOM size and decoded images and the server's `process.memoryUsage()`. `manifest.json` (PIDs, `app.getAppMetrics()` before and after) is written last. Start with `memory.json` when a process is larger than its heap snapshot. In a dev desktop build you can drive it over CDP (`OPENCODE_DESKTOP_REMOTE_DEBUGGING_PORT`, default 9222): press `Control+Shift+P`, type `heap snapshots`, press Enter.

The Unix `SIGUSR1` listener in `packages/cli/src/heap.ts` shares the same writer (`packages/util/src/heap-snapshot.ts`) and is still useful for a process that is not an HTTP server, such as a TUI client:

1. Find the processes and inspect their roles and memory:

```bash
pgrep -af opencode
ps -o pid,ppid,rss,vsz,lstart,etime,cmd -p <pid>,<pid>
```

2. Signal the process whose heap needs investigation. For shared-service memory, target the `opencode serve --service` process, not a TUI process:

```bash
kill -USR1 <server-pid>
```

3. Wait for `heap snapshot written` in the channel's log before opening the file. Snapshots are written to the same log directory as `heap-<pid>-<timestamp>.heapsnapshot`; writing a large heap can take several seconds and the file is incomplete until the completion message appears:

```bash
grep 'heap snapshot' ~/.local/share/opencode/log/opencode.log | tail
find ~/.local/share/opencode/log -maxdepth 1 -name 'heap-<server-pid>-*.heapsnapshot' -printf '%T@ %s %p\n' | sort -nr | head
```

Use `opencode-local.log` instead for a local/dev channel process. The log's `path=` field is authoritative.

4. Analyze the snapshot with Chrome DevTools, a V8 heap snapshot parser, or a temporary tool installed outside the repository. Start with the largest retained objects, dominators, object counts grouped by constructor/name, and retainer paths back to GC roots. Relate suspicious names and paths back to the source tree rather than treating large shallow allocations as leaks.

For command-line analysis, install tooling under `/tmp/opencode`, not in the repository. For example, MemLab can rank dominators and trace a reported heap object ID back to a GC root:

```bash
npm install --prefix /tmp/opencode/heap-analysis @memlab/cli
/tmp/opencode/heap-analysis/node_modules/.bin/memlab analyze object-size --snapshot <snapshot>
/tmp/opencode/heap-analysis/node_modules/.bin/memlab analyze shape --snapshot <snapshot>
/tmp/opencode/heap-analysis/node_modules/.bin/memlab trace --snapshot <snapshot> --node-id=<id>
```

A single snapshot explains what retains memory at one point in time, but does not by itself prove a leak. For leak confirmation, capture a baseline, perform a controlled repeated workload, allow idle cleanup/GC when possible, capture another snapshot, and compare growth and retainer paths. Also compare snapshot heap size with process RSS: a large difference can indicate native allocations, database mappings, allocator fragmentation, or other memory outside the JavaScript heap.

```bash
cat /proc/<pid>/smaps_rollup
pmap -x <pid> | sort -k3 -nr | head -25
```

Heap serialization itself can temporarily increase RSS and allocator high-water marks, so record `ps`/`smaps_rollup` both before and after capture. Large anonymous mappings with a comparatively small live heap require native-allocation or allocator investigation; they cannot be explained from JavaScript retainer paths alone.

## CPU profiles

The CLI installs a `SIGPROF` listener on non-Windows processes in `packages/cli/src/cpu-profile.ts`. One signal starts a ten-second CPU profile and stops it automatically; additional signals are ignored while a profile is active. There is no CPU profile CLI flag or environment variable.

1. Get the PID from the info endpoint. For shared-service performance, target the server PID returned here rather than a TUI process:

```bash
opencode api get /api/info
```

Use `bun dev api get /api/info` instead when targeting the local/dev channel.

2. Start the capture:

```bash
kill -PROF <server-pid>
```

3. Wait for `CPU profile written` in the channel's log before opening the file. Profiles are written to the same log directory as `cpu-<pid>-<timestamp>.cpuprofile`; the log's `path=` field is authoritative:

```bash
grep 'CPU profile' ~/.local/share/opencode/log/opencode.log | tail
find ~/.local/share/opencode/log -maxdepth 1 -name 'cpu-<server-pid>-*.cpuprofile' -printf '%T@ %s %p\n' | sort -nr | head
```

Use `opencode-local.log` for a local/dev process. Load the completed `.cpuprofile` in Chrome DevTools or another V8 CPU profile viewer and inspect the hottest functions, call stacks, and self time during the controlled workload.

## Debugger

- To debug the CLI or TUI with Bun's inspector, launch the CLI entrypoint through Terminal Control with an inspector URL, then attach a debugger to that URL:

```bash
termctrl start opencode-debug --host opentui --cols 112 --rows 34 -- \
  bun run --inspect=ws://localhost:6499/ src/index.ts
```

- Use `--inspect-wait` or `--inspect-brk` when execution must pause until a debugger attaches.
- Use `termctrl logs opencode-debug` for inspector output or startup failures emitted before the TUI renderer starts. Use `termctrl show` for the visible full-screen TUI.

## Verification

- Run `bun typecheck` from `packages/cli` after CLI adapter changes.
- Run `bun typecheck` and `bun test` from `packages/tui` after shared TUI changes. Do not run tests from the repository root.
- Treat automated checks and Terminal Control smoke tests as complementary. For user-visible changes, verify initial render, the changed interaction, Ctrl-C exit behavior, and save a screenshot of the corrected state.
