# Manual app performance suite

The app's high-volume performance diagnostics live under `packages/app/e2e/performance` and are excluded from normal local and CI Playwright discovery. The benchmark config builds the app and serves the production bundle before running scenarios serially.

The `devex` category is the explicit exception to the production-build rule. It measures development commands from submission through a user-visible ready state and has its own Playwright configuration.

Run the suite explicitly from `packages/app`:

```sh
bun run test:bench
```

Run the desktop development startup benchmark from the repository root:

```sh
bun run bench:devex
```

It runs five serial samples of the exact `bun dev:desktop` command. Each sample uses a fresh desktop profile, database, service configuration, service registration, and service process; the desktop selects an isolated ephemeral loopback endpoint. It removes desktop build output and the desktop Vite cache before every run; dependencies, Bun's package cache, and Electron remain installed. The harness stops only that sample's service; it does not stop or change the elected global OpenCode service. The measured endpoint is a visible Home page whose empty-state controls pass Playwright actionability checks. The command's Electron installation check remains inside the measured interval.

Set `DESKTOP_STARTUP_RUNS` only for focused diagnostics:

```sh
DESKTOP_STARTUP_RUNS=1 bun run bench:devex
```

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to capture the renderer's CDP trace from attachment through actionable Home:

```sh
DESKTOP_STARTUP_RUNS=1 OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-desktop-traces bun run bench:devex
```

PowerShell:

```powershell
$env:PLAYWRIGHT_WORKERS = "1"
bun run test:bench
```

The suite contains:

- cold and hot session-tab timing
- home-session click timing split between content and titlebar-tab paint
- single-session tab close timing through stable home restoration
- cached session repaint and mutation tracing
- streaming timeline throughput, RAF-gap, long-task, geometry, and remount diagnostics
- retained renderer heap with a large model catalog across repeated session navigation

All benchmarks import the shared `benchmark` fixture. Pages created through Playwright's `page` fixture automatically capture main-frame navigation history and emit a Chrome trace when `OPENCODE_PERFORMANCE_TRACE_DIR` is set. Benchmarks that need isolated browser contexts use `withBenchmarkPage`, which owns the context and the same diagnostics lifecycle.

New benchmarks should look like normal Playwright tests:

```ts
import { benchmark, expect } from "../benchmark"

benchmark("measures one interaction", async ({ page, report }) => {
  // Only scenario-specific setup and interaction belong here.
  report({ durationMs: 42 })
})
```

The fixture requires every benchmark to call `report()`, automatically names and closes traces, captures navigation history, attaches that history when a test fails, and emits metrics as a consistent `BENCHMARK` JSON line.

```text
BENCHMARK {"name":"...","context":{"project":"chromium","platform":"darwin"},"metrics":{...}}
```

Every observed page also emits `BENCHMARK_PAGE` with the same run ID, navigation history, optional trace path, and trace scope before the final status-bearing `BENCHMARK` record. Chrome traces are browser-wide; the default window is page lifetime. Tab-switch traces begin after scenario setup and include explicit interaction markers. Scenario metrics use their own narrower observation windows.

This follows the stack's own guidance: [Electron recommends repeated Chrome DevTools and Chrome Tracing measurement](https://www.electronjs.org/docs/latest/tutorial/performance), [Chrome DevTools recommends Performance recordings for runtime work](https://developer.chrome.com/docs/devtools/performance), and [Playwright uses traces for test debugging rather than renderer profiling](https://playwright.dev/docs/trace-viewer).

These Playwright benchmarks profile the shared app renderer in Chromium. A future packaged Electron benchmark that needs main-process and multi-process attribution should use Electron's official [`contentTracing`](https://www.electronjs.org/docs/latest/api/content-tracing/) API rather than extending this renderer harness with bespoke process instrumentation.

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

The streaming scenario's 30x CPU throttle is a deterministic stress profile, not a simulated end-user device.

Benchmarks do not assert machine-dependent performance budgets. Streaming processes 160 deltas by default and reports renderer-observed completion time, throughput, RAF callback-gap distributions, frame-budget equivalents, and long tasks through final geometry settlement. Delta count and delivery batch are included in result context when overridden. These are main-thread callback diagnostics, not compositor presentation or dropped-frame measurements. Visual-only and geometry metrics are `null` when their probes are disabled. Tab metrics describe sampled DOM observations. Assertions verify scenario and metric collection completion. Repeated repaint states are run-length grouped, but every original observation timestamp is retained alongside raw mutation batches and layout shifts.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

Tab-switch timing starts at `mousedown`, when mouse-selected tabs actually navigate, with a `click` fallback for keyboard activation. The probe excludes hidden/transparent content and intersects answers with their virtual-row clip and viewport. The tab workload requires the destination's final answer to be visible with Markdown ready. These results are not directly comparable to older click-start, geometry-only measurements. `stableObservedMs` includes confirmation across three correct samples; `firstCorrectObservedMs` is the first sample meeting all content and geometry checks. Neither is a compositor presentation timestamp.

Each tab scenario reports one sample, including its raw observations. Use Playwright's `--repeat-each=20` for a baseline distribution. Warm scenarios prepare the destination at the same panel width before leaving it; a separate resized scenario validates reuse after opening the review pane changes that width.

The tab-switch workload uses two equally long sessions: 200 user/assistant exchanges (400 messages) per tab. Every answer includes headings, emphasis, links, a blockquote, task and nested lists, an eight-row table, and four highlighted code fences (TSX, JSON, SQL, Bash), alongside the stress fixture's reasoning and tools. The mock API deliberately returns all 400 messages in one response so every scenario measures a long loaded history, not a short paginated tail. The viewport is fixed at 1440 x 900. Results include the fixture version, Markdown and serialized-message byte counts, and message-request count. These numbers are not directly comparable to the earlier 12-exchange source / 72-exchange destination fixture.

Cold means the destination transcript has never loaded or rendered in that fresh browser context. Its measured switch includes one fixture message fetch. Warm means its complex answer was rendered and ready before switching away and back, and asserts no message fetch during the measured switch. Neither includes app startup or the source session's Markdown engine initialization. These cold results are not comparable to older prefetched cold-render results. Setup waits for mounted Markdown to finish and for the review-pane width transition to complete. Service workers are blocked to exclude the web build's background asset precache from this renderer benchmark. Screenshots are attached after measurement for the first repetition; Playwright video and trace recording are disabled for this workload, while opt-in Chrome profiling remains available. For a baseline distribution, use `--repeat-each=20 --retries=0`, keep profiling disabled, and report the median and p95 of `firstCorrectObservedMs` separately from the three-observation `stableObservedMs`.

```sh
bunx playwright test --config e2e/performance/playwright.config.ts \
  timeline/session-tab-switch-benchmark.spec.ts --repeat-each=20 --retries=0
```

**The tab-switch fixture returns full history, not normal pagination.** Measure cold API navigation, Home-row opening, and restored-but-unvisited tabs separately with normal pagination. Do not combine these entry paths or compare different transports and machine-load periods as one experiment.

`inactive-tab-prefetch-benchmark.spec.ts` restores eight tabs with normal 20-message pages (44 parts and 139,257 response bytes per page). It gates heavy responses independently until every tab's attention callback has run, then measures selection with ready answer Markdown and bottom anchoring. A separate case closes an inactive tab before releasing the responses. The fixture reports speculative transcript/inbox reads, request concurrency, response bytes, and activation latency. Set `OPENCODE_PERFORMANCE_MEMORY=1` only in separate retention runs; those force GC before selection and must not be mixed into clean timing results. The scope is the production browser renderer, not total desktop memory. Live background events and eviction of previously visited transcripts are separate workloads.

Keep one-off reports, recorded results, and traces outside git, in the ignored `e2e/performance/results/` directory or an external artifact directory. Preserve raw observations locally and publish anonymized summaries and charts in the PR description, not as committed experiment files.

For a repeatable tab-switch summary, run from `packages/app`:

```sh
bun run bench:tabs
```

This runs only the tab-switch benchmark against the production build with 20 serial repetitions and no retries. It prints the median (mean of the two middle values for even sample counts) and nearest-rank p95 for `firstCorrectObservedMs` and `stableObservedMs` per scenario. Only records whose benchmark and Playwright statuses are passed and whose two metrics are finite enter the summary. Test and record statuses, missing records, and excluded samples are reported separately.

For fresh entry paths, run `bun run bench:entry` from `packages/app`. It uses the same production, serial-repetition, and reporting defaults. The cases open an empty draft from the actual Home button, create a draft with the titlebar plus from an active session, and open a cold paginated session from Home. Draft readiness requires a focused editable composer, the expected model, project control, and new tab; typing and absence of backend mutations are checked afterward. Session readiness requires the latest group, ready answer Markdown, and bottom anchoring. These cases are separate from cached tab remounts.

For milestone charts, rerun frozen builds with one workload and counterbalanced serial order. Do not connect historical medians from different transports, preparation, or machine-load periods. Show samples or ranges, name the checkpoints accurately, and distinguish experimental build snapshots from Git commits.

Complete original `BENCHMARK` JSON records, including samples, context, and failed records, are saved as `tab-switch-benchmark.jsonl` in Playwright's configured output directory (default: `e2e/test-results/performance`). Standard Playwright flags can override defaults when appended:

```sh
bun run bench:tabs --repeat-each=3 --output=e2e/test-results/tabs-smoke
```

Set `OPENCODE_PERFORMANCE_MEMORY=1` for an opt-in renderer-main-isolate heap and DOM sample after mounted content is ready and an explicit GC completes. Probe DOM references are released before collection. This is not total desktop memory; do not mix these diagnostic runs with unprofiled latency samples. Set `OPENCODE_PERFORMANCE_TRACE_DIR` for a separate Chrome trace of each tab interaction, starting after preparation, with `session-switch:start`, `session-switch:ready`, and `session-switch:stable` markers.

### Cache-Enabled HTTP Fixture

The default tab harness uses Playwright routing for API responses. Playwright routing disables the browser HTTP cache, including for unrelated SVG assets. To measure with HTTP caching enabled, the same API handlers and tab data can run on a real loopback HTTP endpoint:

```sh
bun run build
bun e2e/performance/tab-switch-server.ts --port 4639 --dist dist
```

With that fixture running, run the benchmark in a separate terminal from `packages/app`:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4639"
$env:OPENCODE_PERFORMANCE_HTTP_FIXTURE = "1"
bun run bench:tabs
```

Use `--dist` to select a frozen production bundle when comparing revisions. An explicit `PLAYWRIGHT_BASE_URL` means the benchmark does not rebuild or start another preview. The fixture gives hashed assets immutable cache headers; it serves the deterministic read workload, not the live OpenCode service. Each test still gets a fresh browser context, and source-session setup still occurs before the measured switch. API responses use `no-store`, service workers remain blocked, and no destination Markdown is rendered before a cold switch. Records identify the transport as `http` or `playwright-route`; keep these series separate. Unset `OPENCODE_PERFORMANCE_HTTP_FIXTURE` when returning to the default routed harness.

## Retained renderer memory

Run the catalog workload against the production app bundle:

```sh
bunx playwright test --config e2e/performance/playwright.config.ts \
  timeline/provider-memory-benchmark.spec.ts --repeat-each=3
```

`PROVIDER_MEMORY_MODELS` defaults to 1,200 and `PROVIDER_MEMORY_SWITCHES` defaults to 10. Each sample records Chromium's `Runtime.getHeapUsage` and `Memory.getDOMCounters` after an explicit garbage collection. This measures retained state, not allocation peaks or normal GC timing. It does not include worker heaps, the Electron main/GPU processes, or the OpenCode server, and must not be reported as total desktop RAM. Use identical model counts and navigation sequences for before/after comparisons.

`location-catalog-benchmark.spec.ts` restores one session tab per workspace for 5, 15, and 30 distinct directories. The mock serves every directory as its own location with the same 1,200-model catalog plus 8 agents with system prompts, 24 commands, and 12 skills with SKILL.md content. The scenario visits every tab, switches back to the first tab, closes every tab, pushes a `credential.switched` event, reopens one workspace from Home, and reconnects the event stream. Each phase records catalog requests by path and directory; the retained heap is sampled after an explicit GC between phases, so the visit and revisit timings are Playwright-observed diagnostics rather than clean latency samples. `LOCATION_CATALOG_DIRECTORIES` (default `5,15,30`) and `LOCATION_CATALOG_MODELS` (default 1,200) adjust the workload.

The second case holds all first catalog responses until every tab has closed and the credential event has been handled. It then releases the responses while Home remains visible, waits for the catalog body readers to finish, samples retained heap, and reopens a workspace. This exposes late responses and event refreshes queued behind released reads. The browser probe retains only request counters, not payloads. `LOCATION_CATALOG_PENDING=0` selects the loaded case; `1` selects the pending case. Set `LOCATION_CATALOG_MEMORY=0` for separate timing runs with no forced GC. To compare frozen production bundles without rebuilding, set `CATALOGS_DIST` to the bundle directory and use `e2e/performance/playwright.catalogs.config.ts`.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit a standard Chrome DevTools trace for every benchmark page automatically:

```sh
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
bunx playwright test --config e2e/performance/playwright.config.ts \
  timeline/session-tab-switch-benchmark.spec.ts
```

The emitted JSON is a standard Chrome trace and can be loaded directly into the Chrome DevTools Performance panel. `devtools-tracing` can optionally inspect it from the command line without adding package scripts or dependencies:

Trace capture follows [Puppeteer's tracing lifecycle](https://pptr.dev/api/puppeteer.tracing), using Chrome's `ReturnAsStream` transfer mode and failing when Chromium reports trace data loss. V8 CPU sample stacks support attribution through the frozen build's source maps. Set `OPENCODE_PERFORMANCE_STACK_TRACE=1` only when per-event timeline stacks are needed; they add substantial overhead. Keep profiled runs separate from latency distributions, including when comparing the stack-capture modes.

```sh
bunx devtools-tracing stats <trace-path-from-BENCHMARK_PAGE>
```

INP analysis requires a trace with a supported navigation/interaction insight. Selector statistics require a trace captured with `OPENCODE_PERFORMANCE_SELECTOR_TRACE=1`.

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
