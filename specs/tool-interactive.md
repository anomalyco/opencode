# Interactive Process Tool (V2)

Status: draft
Reference: tool-interactive
Spec source of truth for: the V2 `interactive` tool family — `interactive_start`, `interactive_write`, `interactive_wait`, `interactive_cancel` — which runs long-lived interactive child processes (gdb, REPLs, installers) and lets the model drive them over repeated provider turns; the auto-fed output-delivery protocol, per-job exchange budget, output spooling and bounding, permission gating, job lifecycle, and crash recovery — for anyone implementing the tool family, its job store, or the runner interaction.

## Overview

`bash` runs one command to completion with `stdin: ignore`. Anything that
needs a conversation — setting gdb breakpoints one at a time, answering an
installer prompt, probing a REPL — cannot be expressed as one bounded command.
The `interactive` family spawns such processes as **jobs** that survive across
provider turns and feeds the model their output automatically:

- There is **no `read`/poll method**. The result of every call that touches a
  job (`start`, `write`, `wait`, and the terminal `cancel`) carries the output
  accumulated since the previous result, plus a `status`. The model never asks
  for output; output arrives as a side effect of acting on the job.
- Every settled call is a local tool settlement, so the existing V2 runner
  continuation (reload projected history → next provider turn) **is** the
  auto-feed cycle. The runtime adds no synthetic model input and starts no
  provider turns on its own.
- Each exchange (one settled result → one automatic provider turn) is bounded
  by a per-job exchange budget; exhaustion auto-cancels the job and returns a
  final result with the full-output path.

The V1 `bash` tool and the V2 `bash` tool are unchanged; `interactive` is a
separate family registered beside them.

## Scope

In: the four tool registrations and their input/output schemas; the
Location-scoped job store (job identity, delivery cursor, spool); settle
boundary and status semantics; the auto-feed protocol and its interaction with
the V2 runner continuation and step budget; the exchange/job/lifetime budgets;
permission gating for the family; PTY spawn requirements; the job ledger and
crash recovery; user-interrupt semantics; the model-facing guidance text; the
configurable parameters (`interactive.*`); testing strategy.

Out (non-goals): the V1 tool system (`specs/core-tools-permissions.md`); the
V2 `bash` tool (`packages/core/src/tool/bash.ts`) other than as the permission
and spawn precedent; generic tool registration, execution, and bounding
(`specs/v2/tools.md`); clustered or cross-runtime job placement (jobs are
process-local); background-job completion delivery into idle Sessions (a job
that exits while no call is in flight does not wake the Session); terminal UI
rendering of interactive sessions.

## Relationship to existing specs

- `specs/v2/tools.md` (v2-tools) — the tool type, registration, execution,
  and output-bounding model this family builds on. `interactive` is four
  normal `Tool.make` registrations, not a new tool kind.
- `specs/v2/session.md` (config-v2-session) — the durable invariants this
  design must preserve (durable tool-call projection before side effects;
  `Tool execution interrupted` recovery for projected-running calls) and the
  continuation loop the auto-feed cycle rides on. Post-crash continuation is
  deferred there and stays deferred here.
- `specs/core-tools-permissions.md` (core-tools-permissions) — the V1 bash
  permission precedent (ask on the full command text; `external_directory`
  for outside-worktree working directories). This spec adopts the same shape
  against `PermissionV2` and does not change the V1 system.
- `specs/v2/config-parameters.md` (config-v2) — the `interactive.*`
  parameter rows introduced below.

## Design anchors (as-built hooks this design attaches to)

| Anchor | Role here |
|---|---|
| `packages/core/src/session/runner/llm.ts:250` | Tool-call gate: local calls settle durably in fibers during the stream; `needsContinuation` drives the next provider turn — the auto-feed mechanism requires no runner changes for the basic cycle |
| `packages/core/src/session/runner/to-llm-message.ts:105` | Lowering of settled local tool results (`role: "tool"`) back into provider history — interactive results are ordinary tool results |
| `packages/core/src/session/runner/max-steps.ts` | Agent step budget: each auto-fed exchange consumes one provider turn of the drain's step allowance |
| `packages/schema/src/session-event.ts:331` | `Tool.Progress` durable event — designed, currently published by nobody; this spec is its first publisher (UI liveness under an in-flight call) |
| `packages/core/src/tool/tool.ts` (decode → execute → encode → `toModelOutput`) | The contract each of the four registrations follows; permissions asserted inside `execute` as in `packages/core/src/tool/bash.ts:142` |
| `packages/core/src/tool-output-store.ts` | Bounding precedent (2000 lines / 50 KiB, managed file, 7-day retention) reused for chunks and spool files |
| `packages/core/src/session/runner/llm.ts` (`failInterruptedTools`) | Post-crash rule that durably fails tool calls still projected `running`; interactive relies on it instead of adding job replay |

## Tool surface

The family is one tool name (`interactive`) with four methods, registered as
four sibling registrations so each method gets a flat provider-facing schema
(the V2 registry maps one name to one tool; there is no method dispatch
inside a tool call). The sibling-family precedent is the V1 edit family
sharing one permission key.

- R1. Model-facing ids: `interactive_start`, `interactive_write`,
  `interactive_wait`, `interactive_cancel` (all pass
  `Tool.validateName`). All four share the permission key `interactive`
  (see Permissions, R26–R28), so one blanket deny hides the whole family
  and no method is usable without `interactive_start`.
- R2. Job identity: `jobID` = `ijob_<ascending>` (`Identifier.ascending`).
  Job IDs are Session-scoped: the job store indexes by
  `(sessionID, jobID)` and a call from another Session observes `unknown
  job`. Job IDs are opaque strings to the model.
- R3. Shared structured output (every method returns this shape):

```ts
{
  jobID: string
  status: "waiting" | "running" | "done" | "failed" | "timeout" | "cancelled"
  output: string          // bounded new output since the previous result (may be "")
  truncated: boolean      // chunk cap hit; elided bytes exist only in the spool
  outputPath: string      // managed spool file with the full combined output so far
  exit?: number           // present iff status is done | failed
  reason?: "model" | "exchanges" | "lifetime" | "interrupt" | "session-close" // iff cancelled
  exchanges: number       // exchanges consumed by this job so far
  exchangesRemaining: number
}
```

- R4. Shared text (`toModelOutput`): the bounded `output` text, then a status
  line `[interactive <jobID> status=<status> exchanges=<n>/<max>]`, then —
  when `truncated` — the ToolOutputStore-style marker
  `... output truncated; full output saved to <outputPath> ...`. Terminal
  results additionally state `exit` / `reason`.

### Statuses

- R5. Statuses split by process liveness:
  - **Alive** — `waiting`: the process is quiescent (no new output for the
    quiet window); it is the model's move (usually `interactive_write`).
    `running`: the process is alive and still producing output; this result
    was cut at the chunk cap, and the elided bytes are only in the spool.
    `timeout`: a bounded `interactive_wait` expired without exit; the
    process is alive and the model may wait again, write, or cancel.
  - **Terminal** — `done` (exit code 0), `failed` (non-zero exit, kill
    signal, or spawn failure), `cancelled` (killed with a `reason`).
- R6. Every job ends in exactly one terminal record. After a terminal
  status the job accepts no stdin (see R12) and later calls observe the
  terminal state per R13–R14.

### `interactive_start`

- R7. Input:

```ts
{
  command: string          // shell command string, executed like bash's
  workdir?: string         // defaults to the active Location; relative resolves from it
  timeout?: number         // job lifetime in ms; default interactive.default_timeout_ms,
                           // capped at 3600000
}
```

- R8. Behavior: assert permissions (R26–R28), then spawn the command under
  the interactive process runtime (PTY, R22) in its own process group. The
  call settles at the first settle boundary (R10) — in practice the initial
  banner/prompt makes it `waiting`, a chatty process makes it `running`,
  and an immediate crash makes it `done`/`failed` with the early output.
  Spawn failure settles as status `failed` (message in `output`) rather
  than an opaque tool error, so the model can react.
- R9. Starting beyond `interactive.max_jobs` live jobs for the Session fails
  with a model-facing error listing the live job IDs (the model may cancel
  one and retry).

### `interactive_write`

- R10. Settle boundaries. `start` and `write` settle at the **first** of:
  - **exit** — the child exited → `done`/`failed` (+`exit`);
  - **quiescence** — `interactive.quiet_window_ms` elapsed with zero new
    output bytes while alive → `waiting`;
  - **chunk cap** — new output for this call reached the chunk bound
    (`tool_output.max_lines`/`max_bytes`) → `running`;
  - **killed** — the job was cancelled or lifetime-reaped → `cancelled`.
  `wait` settles at exit, at its own deadline (→ `timeout`), at the chunk
  cap (→ `running`), or when killed. `cancel` settles after the kill
  completes, returning any final drained output (bounded).
- R11. Input:

```ts
{
  jobID: string
  input: string            // exact bytes appended to the child's stdin (include "\n" yourself)
  eof?: boolean            // signal end-of-input after writing (^D on the PTY)
}
```

- R12. `input: ""` without `eof: true` is a model-facing error ("empty
  write"); this plus the missing `read` method makes output polling
  unexpressible. Writing to a terminal job is a model-facing error that
  names the terminal status and `outputPath`. Unknown job (including after
  a runtime restart, or a jobID owned by another Session) is a
  model-facing error ("jobs do not survive runtime restarts").

### `interactive_wait`

- R13. Input: `{ jobID: string, timeout?: number }` — deadline in ms,
  default `interactive.wait_timeout_ms`, capped at 600000. Waits for exit.
  On exit the result is the final one (`done`/`failed`, final output
  portion, `outputPath`); on deadline `timeout` (alive, non-terminal); on
  chunk cap `running`. `wait` on an already-terminal job replays the
  terminal result idempotently (empty new output) — this is how the model
  closes out a job that exited in the background.

### `interactive_cancel`

- R14. Input: `{ jobID: string }`. Kills the process group (SIGTERM, then
  SIGKILL after the same 3 s grace bash uses), closes the PTY, marks the
  job `cancelled` with `reason: "model"`, and returns the final drained
  output (bounded) + `outputPath`. Cancelling a terminal job is an
  idempotent success returning the existing terminal status.

## Auto-feed protocol

```text
Model                Runner / tool fiber              Job store             Child (PTY)
  │  interactive_start("gdb ./a.out")                       │                     │
  ├────────────────────────▶│                               │                     │
  │                         ├─ durable Tool.Called ─▶ EventV2                   │
  │                         ├─ permission.assert(interactive, command)          │
  │                         ├─ spawn ────────────────────────▶ ledger row ─────▶│
  │                         │◀─ settle @ quiescence (banner) ─┤                 │
  │                         ├─ durable Tool.Success (portion, waiting)          │
  │◀─ tool result ──────────┤   needsContinuation = true                       │
  │                         │                               │                     │
  │            ┌─ automatic continuation provider turn (no user input) ────────┐│
  │  interactive_write(jobID, "break main\n")              │                     ││
  ├────────────────────────▶│                               │                     ││
  │                         ├─ durable Tool.Called ─▶ EventV2                   ││
  │                         ├─ stdin append ───────────────────────────────────▶│
  │                         │◀─ settle @ quiescence ──────────────────────────┤│
  │◀─ portion + status ─────┤                               │                     ││
  │            └────────────────────────────────────────────────────────────────┘│
  │  ... cycle repeats until done/failed, or one interactive_wait / cancel ...
```

- R15. The runtime — never the model — initiates the turn that consumes an
  interactive result: because every interactive call is a local tool call,
  its durable settlement sets `needsContinuation` and the existing V2
  runner starts the next provider turn automatically after reloading
  projected history. No synthetic user input, no injected assistant
  message, no runner change is made for the basic cycle.
- R16. The cycle ends when (a) a result is terminal (`done`, `failed`,
  `cancelled`) — the model has no obligation to call again; (b) the model
  calls `wait` (block to completion) or `cancel` (terminate); or (c) the
  model simply stops calling interactive tools and ends its turn — the
  drain then settles per the normal runner rules and the job stays alive
  in the background under its budgets (R18–R20). The model guidance
  (R33) requires exactly one terminal call per job, but the protocol
  tolerates a dangling job: later turns may resume it by jobID.
- R17. Background transitions publish nothing to the provider. A job that
  exits, floods, or is lifetime-reaped while **no** interactive call is in
  flight produces no provider turn and no synthetic message; the exit is
  recorded in the job store and observed by the next call (`wait` replays
  it per R13). Interactive publishes `session.next.tool.progress`
  (`Tool.Progress`, currently unpublishing) under the in-flight call only
  — structured `{ jobID, status, cursor }` with a bounded recent tail (≤ 40
  lines) at settle boundaries and at most one per quiet window during long
  waits, honoring the event's bounded-cadence contract. Durable liveness
  for background jobs is a follow-up (L2).

## Governor (budgets)

- R18. **Exchange budget.** Every settled `start`/`write`/`wait` result
  increments the job's exchange counter (`cancel` does not). When a settle
  would exceed `interactive.max_exchanges` (default 20), the tool
  auto-cancels the job instead and returns one terminal result:
  `status: "cancelled"`, `reason: "exchanges"`, the bounded final portion,
  and `outputPath`. The status line names the budget so the model stops
  without probing.
- R19. **Parallel jobs.** At most `interactive.max_jobs` (default 3) live
  jobs per Session (R9). Jobs of different Sessions and different drains
  run concurrently; calls against one job serialize in the job store (a
  second call while one is in flight for the same job fails fast with a
  model-facing error naming the in-flight call).
- R20. **Job lifetime.** A job lives at most its `timeout` (R7). The
  lifetime reaper kills expired jobs (`cancelled`, `reason: "lifetime"`)
  whether or not a call is in flight; a killed in-flight call settles with
  that result.
- R21. **Agent steps.** Every exchange is one provider turn and consumes
  the drain's agent step allowance (`max-steps.ts`). The exchange budget
  does not reserve agent steps: if the runner reaches the step ceiling
  first, tools are disabled (text-only turn) and an open job is reaped by
  its lifetime (R20). Model guidance (R33) tells the model to finish jobs
  well before either ceiling; the gap is a known limitation (L7).

## Process runtime

- R22. The child is spawned under a PTY in its own process group on POSIX
  so interactive programs see a terminal (prompts, line buffering,
  isatty-dependent behavior — without a tty, e.g. `python3 -i` prints no
  `>>>` prompt). stdout and stderr are the merged PTY stream. On Windows
  the fallback is pipes (known limitation, L4). The process runtime is a
  service boundary (like `AppProcess`) so tests substitute a fake child
  (R34).
- R23. The PTY master is owned by the job store; killing a job closes it.
  Runtime exit closes all masters (children receive SIGHUP); the startup
  sweep (R30) is the belt-and-braces reaper for children that survive.

## Output bounding and spool

- R24. The spool: every job continuously appends its combined output to
  one managed file `<data>/tool-output/tool_ijob_<id>` — the
  ToolOutputStore directory and naming prefix, so the existing 7-day
  retention applies — capped at `interactive.max_spool_bytes` (default 8
  MiB); past the cap the spool stops appending and results say so. The
  `outputPath` field of every result names this file; the model may page
  it with the `read` tool.
- R25. The chunk: each result embeds the bytes produced since the
  **delivery cursor** (the offset embedded by the previous result), bounded
  by `tool_output.max_lines`/`max_bytes` (defaults 2000 / 50 KiB — no new
  keys; the same limits the generic settlement boundary would apply, so it
  no-ops on self-bounded results). On truncation the cursor still advances
  to the current end: elided bytes are never re-embedded in later results
  (read the spool instead). The cursor is monotonic.

## Permissions

- R26. `interactive_start` asks `PermissionV2.assert` with action
  `interactive`, `resources: [command]`, `save: [command]` — the same
  shape as the V2 `bash` assert (`packages/core/src/tool/bash.ts:142`),
  evaluated against the selected agent's ruleset. A structured `workdir`
  outside the worktree first asks `external_directory` exactly as bash
  does; best-effort absolute-path scans of command arguments are advisory
  warnings only, never gates (parity with V2 bash).
- R27. `interactive_write`, `interactive_wait`, `interactive_cancel`
  perform **no permission ask**: they inherit the authorization decision
  made when the job started. Rationale: stdin influences the behavior of a
  process whose command was already authorized under the same rules as
  `bash`; the process already runs with host-user authority, and anything
  the model could achieve by writing stdin it could already achieve by
  running a one-shot `bash` command (which would itself be gated). A
  per-write prompt would also mean one permission round-trip per REPL
  line, which is unusable. The gate is the start.
- R28. The four registrations share the `interactive` permission key
  (`Tool.withPermission`), so a `pattern: "*"` deny hides the entire
  family from materialization (`registry.whollyDisabled`) and no method
  escapes the gate. A declined start follows the existing V2 behavior:
  the drain halts (`PermissionV2.DeclinedError`), as with bash.

## Durability and crash recovery

- R29. **Before the crash** the existing durable invariants hold unchanged:
  the runner projects each complete tool call durably before its fiber
  executes (spawn and stdin writes happen inside `execute`, after the
  durable `Tool.Called`), and each settle publishes `Tool.Success` /
  `Tool.Failure` with the bounded portion. Job state beyond the call
  records — buffers, cursor, process handle — is process-local.
- R30. **The job ledger.** The job store keeps a per-Location ledger file
  (managed data directory, `interactive/<location-key>/jobs.json`,
  atomically rewritten) with one row per live job:
  `{ jobID, sessionID, pgid, startedAt }`, deleted on terminal transition.
  At Location startup, before any new job spawns, the store sweeps the
  ledger: every recorded process group still alive is killed
  (SIGTERM → SIGKILL grace) and its row dropped. Orphan cleanup does not
  wait for the owning Session to be reopened.
- R31. **After the crash** there is no job replay: live job state is gone,
  the sweep killed the orphans, and any tool call still projected
  `running` is durably failed with the existing
  `Tool execution interrupted` rule (`failInterruptedTools`). Stdout
  accumulated before the crash is not re-delivered — the spool file on
  disk still holds it and the model can `read` it, but the delivery
  cursor and auto-feed are lost. Post-crash continuation of an
  interactive job (re-attach, cursor reconstruction) is explicitly
  deferred, mirroring `specs/v2/session.md`'s post-crash continuation
  deferral. Known limitation (L3).

## Interrupt semantics

- R32. `sessions.interrupt` interrupts the active drain; in-flight
  interactive fibers are interrupted like any tool call (existing rules,
  `Tool execution interrupted` for the projected-running call). Jobs that
  had a call in flight in the interrupted drain are killed and marked
  `cancelled` with `reason: "interrupt"` — the user pressed escape; the
  side effect stops. Jobs with no in-flight call survive the interrupt and
  stay under their budgets until a later turn or the lifetime reaper.
  Runtime shutdown kills all live jobs of the Location
  (`reason: "session-close"` in the ledger's terminal audit if a later
  call ever observes it).

## Model guidance

- R33. The four descriptions carry this normative block (verbatim, with
  per-method supplements); it is the model-facing contract the rest of
  this spec assumes:

```text
Use the interactive tools only for processes that need a conversation:
debuggers (gdb), REPLs (python, node), interactive installers, anything
that prints a prompt and waits. For one-shot commands use bash instead —
it is faster and cheaper; never use interactive tools to poll output.

Rules:
- Every result returns new output plus a status. waiting = the process
  awaits your input (send interactive_write). running = output was cut at
  the size cap; the full stream is at outputPath (use the read tool to
  page it). timeout = your interactive_wait deadline expired, the process
  still lives. done/failed/cancelled are final.
- interactive_write input must contain what you would type, including the
  trailing "\n". Never send an empty write; there is no way and no need
  to poll for output.
- Finish every job with exactly one terminal action: interactive_wait to
  let it exit (pass a timeout when it may be slow) or interactive_cancel
  to kill it. Do not leave jobs open when you are done with them.
- Each interaction costs one provider turn and jobs are limited to
  {max_exchanges} exchanges and {max_jobs} concurrent jobs per session;
  when a job exceeds its budget the runtime cancels it and tells you.
  Batch related work into fewer, larger writes.
```

## Testing

- R34. The process runtime is a service boundary; tests substitute a fake
  child that replays scripted `(bytes, delay)` events, making settle
  boundaries (exit / quiescence / cap / kill) deterministic without real
  PTYs or wall-clock sensitivity beyond injected quiet windows.
- R35. Real-child fixtures are POSIX `sh` scripts — a fake REPL is
  `while IFS= read -r line; do [ "$line" = quit ] && exit 0; echo "got: $line"; done`,
  a fake installer prints numbered prompts and branches on input, a
  flood fixture emits more than the chunk cap. No test requires gdb or
  any real debugger; fixtures live in the core test tree and run under
  the configured shell.
- R36. Determinism of the auto-cycle: tests inject small
  `interactive.quiet_window_ms` (e.g. 20) and small chunk limits via
  config entries; every settle is one of the four boundary conditions,
  so sequencing is reproducible. Governor tests drive a scripted child
  with `interactive.max_exchanges: 2` and assert the auto-cancel result
  carries `reason: "exchanges"` and the spool path. Crash tests kill the
  runtime between turns and assert the ledger sweep reaps the pgid and
  the projected-running call replays as interrupted.

## Invariants

- I1. No interactive side effect (spawn, stdin byte, kill) happens before
  the owning call's durable `Tool.Called` projection — inherited from the
  runner, restated because the side effects outlive their calls.
- I2. Every auto-fed exchange is the settlement of one explicit
  interactive tool call; the runtime never initiates a provider turn for
  background output, and there is no model-facing output-polling method.
- I3. A terminal job never accepts stdin; `write` on it fails
  model-facing with the terminal status and `outputPath`.
- I4. Each job ends in exactly one terminal record; alive statuses are
  exactly `waiting` / `running` / `timeout`.
- I5. Result text is bounded by `tool_output` limits by construction; the
  spool path appears in every result and the truncation marker whenever
  bytes were elided.
- I6. The delivery cursor is monotonic and elided bytes are never
  re-embedded.
- I7. Only `interactive_start` (and its external workdir) passes through
  permission asserts; `write`/`wait`/`cancel` never prompt.
- I8. Budget exhaustion auto-cancels exactly once and its terminal result
  names the full-output path.
- I9. Before any new job spawns in a Location, the startup sweep has
  killed every ledger-recorded orphan process group.
- I10. Interrupting a drain kills exactly the jobs with calls in flight
  in that drain; other jobs are untouched.

## Known limitations and follow-ups

- L1. One exchange = one full provider round trip; latency and cost scale
  with the number of exchanges and the growing history (compaction
  mitigates context growth). Not suitable for high-frequency interaction;
  use `bash` for one-shot work.
- L2. No durable liveness and no provider visibility for background
  transitions: a job that exits with no call in flight is silent until
  the next call; `Tool.Progress` publishes only under an in-flight call
  (its schema requires `assistantMessageID`/`callID`).
- L3. No post-crash continuation or stdout re-delivery; orphans are killed
  at startup and in-flight calls replay as interrupted (mirrors the V2
  session post-crash deferral).
- L4. PTY spawn is POSIX-only; Windows runs pipes (no prompts from
  tty-sensitive programs); ConPTY is a follow-up.
- L5. Jobs are process-local and Location-scoped; no clustering, remote
  placement, or cross-runtime observation (matches the local-only drain
  boundary of V2 sessions).
- L6. PTY passthrough is unfiltered: ANSI/terminal control sequences and
  echo reach the model verbatim; scrubbing is a follow-up.
- L7. The exchange budget does not reserve agent steps; a job may still be
  open when the step ceiling disables tools, leaving only the lifetime
  reaper to end it.
- L8. The ledger is a side file, not durable session events; folding job
  lifecycle into EventV2 (giving background exits replayable records)
  is the natural next step after L2.

## Configuration

All keys are V2 config (`opencode.json` documents), consumed through the
Location config service; see `specs/v2/config-parameters.md` for the
parameter rows. The per-result chunk bound intentionally reuses
`tool_output.{max_lines,max_bytes}` (no new keys).

| Name | Allowed / range | Default | Effect |
|---|---|---|---|
| `interactive.max_jobs` | positive int | 3 | Live jobs per Session (R19) |
| `interactive.max_exchanges` | positive int | 20 | Settled results per job before auto-cancel (R18) |
| `interactive.quiet_window_ms` | positive int (ms) | 500 | Quiescence window for `waiting` (R10) |
| `interactive.wait_timeout_ms` | positive int ≤ 600000 | 120000 | Default `interactive_wait` deadline |
| `interactive.default_timeout_ms` | positive int ≤ 3600000 | 900000 | Default job lifetime (R7/R20) |
| `interactive.max_spool_bytes` | positive int | 8388608 | Spool file cap (R24) |

## Dependencies

- v2-tools — tool type, registration, execution, settlement, generic
  bounding this family is built from.
- config-v2-session — durable tool-call and continuation invariants the
  auto-feed cycle rides on; post-crash deferral this spec mirrors.
- core-tools-permissions — V1 bash permission precedent adopted here
  against `PermissionV2`.
- config-v2 — the `interactive.*` parameter rows.

## Used by

- config-v2 — the `interactive.*` keys extend the V2 parameter surface.
