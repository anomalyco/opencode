# Server performance workloads

Keep the cases separate. A win at 100 concurrent workers does not compensate for a slower single session.

| Workload              | Fixed work per run                                                                                                                                                                                                             | Primary                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `coding.bench.ts`     | One existing session: read a tracked file, run `git ls-files`, finish the report. Repeat the same three steps with 12 or 78 prior messages.                                                                                    | Server main-thread CPU µs; divide by three for CPU/step.                                       |
| `background.bench.ts` | One parent resumes 13 existing children in the background, goes idle, then handles 13 distinct completion notifications. Nine children run a real 3.1 s shell job; four read a file. 41 steps, 26 tools, 14 parent executions. | Main-thread CPU µs per completed job. Keep wall time and independent API latency alongside it. |
| `agents.bench.ts`     | Ten concurrent foreground parents, ten children each. Burst stress, not a typical user.                                                                                                                                        | Server process-tree CPU ms, including Git.                                                     |

The two history cases import synthetic settled exchanges through the public API **outside timing**. Each exchange contains a user request, a completed `read` with a generated source listing, and an assistant summary. The real runner reloads this history and encodes it on every step. `count.request_bytes` measures actual incoming Anthropic Messages request bytes at the loopback fixture; reported model usage is not a proxy for payload size. Stream framing follows the [recorded Messages exchange](../../ai/test/fixtures/recordings/anthropic-messages/anthropic-opus-4-7-image-tool-result.json).

For the background case, the live calibration targets were 13 linked children with an idle parent, nine running tools in a spot check, shell-heavy work, 78 prior messages and ~3.1 s median between provider EOF and step completion. Children reach their final model calls independently. The fixture releases the first completion only after the parent parks and all children reach that point; later completions are released after the previous acknowledgement. This deliberately measures individual wakeups, not a scheduler-dependent number of coalesced notifications. Long real waits, provider pacing and token counts are not reproduced exactly; this is not a recording of a pinned server.

```text
Strobe runner                          Strobe script host (measured)
  1 SDK client ── prompts over HTTP ──► OpenCode HTTP server ──► SQLite / Git / read
               ◄── public event SSE ──             │
  loopback model ◄──── Chat HTTP ──────────────────┘
                 ───── paced SSE ─────────────────►
```

Ten parents run concurrently. Each makes ten foreground `subagent` calls in one step. Each child reads three different sections of a tracked file, streams reasoning and text, then returns a Markdown report. Each parent must receive its children's reports before it can finish. At 10×10 that's **420 model requests, 400 successful tool calls, and 110 completed reports**.

## Run

Install the locked workspace dependencies with `bun install --frozen-lockfile`. From the repository root:

```sh
# Validate each user journey independently.
strobe bench packages/server/perf/coding.bench.ts --head . --check
strobe bench packages/server/perf/background.bench.ts --head . --check
# Validate the reported smaller reproduction or the default stress case.
strobe bench packages/server/perf/agents.bench.ts --head . --check --params parents=1,children=6
strobe bench packages/server/perf/agents.bench.ts --head . --check --params parents=2,children=20
strobe bench packages/server/perf/agents.bench.ts --head . --check --params parents=2,children=20,interval=5
strobe bench packages/server/perf/agents.bench.ts --head . --check

# Server CPU and allocation stacks. Timing from a profiled run is not a baseline.
strobe record --bench 'packages/server/perf/agents.bench.ts#concurrent agent trees' --head .
strobe query <rec> hotspots --by file
strobe open <rec>

# A/B a server change with the same workload; keep diagnostic probes off.
strobe bench packages/server/perf/agents.bench.ts --base origin/dev --head . --why always
```

- **`cpu.work`** measures server process-tree CPU milliseconds per completed workload, including Git. `cpu.app.total` is a percentage of one core, **not** the main thread's utilization. Neither metric tells you whether another client stalled.
- **Boundary:** setup starts the real listener on an ephemeral port, initializes a private Git repo and on-disk database, and creates named parents. A run opens one event stream, submits all prompts and waits for terminal execution events. Reset removes the session trees and creates fresh parents outside timing. The Location, process and store stay warm across runs in a block.
- **Validity:** the driver checks every parent–child relationship, complete Markdown report, model request and successful step/tool count. It rejects unexpected requests, retries, tool failures, permission prompts, stream disconnections and timeouts. `count.peak_children` measures overlapping child executions, not just children created. Client deltas can be coalesced; provider frame/byte counts measure the offered traffic.
- **Wire fidelity:** the model serves the reasoning and text prefix and the finish/usage frames from the [recorded GLM-5.3 tool loop](../../ai/test/fixtures/recordings/zai-chat/glm-5-3-preserves-reasoning-through-a-tool-loop-and-follow-up.json). Tool names, IDs, argument fragments and final Markdown are scripted so real tools execute and their output is checked. The cassette has no arrival timestamps: `interval=20` requests a 20 ms gap per frame, `interval=5` increases offered rate fourfold. Timer scheduling and receiver backpressure can reduce the delivered rate. The fixed usage fields are not measurements of token consumption.
- **Limits:** one loopback OpenAI-compatible HTTP provider, one event subscriber, one small Git project, initially empty histories. This does not model a live user's catalog, MCP plugins, large diffs, years of DB history, WebSocket transport or UI rendering. A negative result rules out none of those.

### Comparing with a running server

Match the **active roots and children**, not the number of sessions in the database. An active session can wait for inference, wait on a tool, or run on CPU. Children can keep running after their parent becomes idle; this benchmark instead has foreground parents waiting for all their children. Matching the counts does not match that behavior.

- Bracket each OS thread-CPU interval with `/api/session/active` samples. Keep CPU from slow or missing API responses, but leave the concurrency for that interval unknown. Use the diagnostic `activity` timestamps to select the same child-count intervals in the fixture.
- Compare completed steps per active-session minute (completed steps divided by the time integral of active session count), provider protocol, prior message count, input including cache, and tool mix. Public text deltas are already batched; they cannot tell you the incoming provider frame rate. Cassette usage fields cannot establish real context size.
- On a build machine, separate **server main-thread**, **server process**, and **compiler** CPU. A timed-out client request with no server CPU charged in that interval is a different finding from a one-core spin. Neither short check runs nor one live incident establish a general saturation threshold.

## Does it pin the main thread or stall another request?

For a **diagnostic check only**, set `SERVER_BENCH_DIAGNOSTICS` to an output directory. Do not use these runs for timing comparisons. Example in PowerShell:

```powershell
$env:SERVER_BENCH_DIAGNOSTICS = Join-Path $env:TEMP 'opencode-server-evidence'
strobe bench packages/server/perf/agents.bench.ts --head . --check --params parents=2,children=20
strobe bench packages/server/perf/agents.bench.ts --head . --check

# Separate, perturbed pass: Bun CPU stacks strictly between prompts and completion.
$env:SERVER_BENCH_PROFILE = '1'
strobe bench packages/server/perf/agents.bench.ts --head . --check
Remove-Item Env:SERVER_BENCH_DIAGNOSTICS, Env:SERVER_BENCH_PROFILE
```

- Each successful diagnostic writes `<parents>x<children>-<timestamp>.json`. `thread` contains cumulative main-thread user+system CPU and elapsed milliseconds from Bun's OS thread counter, sampled roughly once per second. Divide **differences** (`Δcpu / Δelapsed`) to get core occupancy. A delayed callback spans the entire delay; don't assume a one-second denominator.
- `baseline` and `loaded` are individual authenticated `GET /api/info` requests from the driver. A timer starts one every 250 ms without waiting for previous responses. `at` is the actual time sent; inspect gaps and errors as well as p95 and max latency. Baseline is a short idle control, not a statistical verdict. For a heavier read path, change the probe rather than inferring its latency from this endpoint.
- With `SERVER_BENCH_PROFILE=1`, import the adjacent `.cpuprofile` with `strobe record "file:<absolute-path>"` and use `strobe open <rec>` for its flame graph. This samples JS and native calls visible to Bun, not kernel or Git stacks. Strobe's regular `script()` attribution recording includes startup and resets; this optional profile excludes them.
