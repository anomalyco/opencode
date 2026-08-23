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

Every observed page also emits `BENCHMARK_PAGE` with the same run ID, navigation history, and optional trace path before the final status-bearing `BENCHMARK` record. Chrome traces are browser-wide page-lifetime diagnostics; scenario metrics use narrower explicitly named observation windows.

This follows the stack's own guidance: [Electron recommends repeated Chrome DevTools and Chrome Tracing measurement](https://www.electronjs.org/docs/latest/tutorial/performance), [Chrome DevTools recommends Performance recordings for runtime work](https://developer.chrome.com/docs/devtools/performance), and [Playwright uses traces for test debugging rather than renderer profiling](https://playwright.dev/docs/trace-viewer).

These Playwright benchmarks profile the shared app renderer in Chromium. A future packaged Electron benchmark that needs main-process and multi-process attribution should use Electron's official [`contentTracing`](https://www.electronjs.org/docs/latest/api/content-tracing/) API rather than extending this renderer harness with bespoke process instrumentation.

CPU and high-volume visual profiling are disabled by default. Set `TIMELINE_CPU_PROFILE=1` to enable both, or additionally set `TIMELINE_VISUAL_PROFILE=0` for CPU-only profiling.

The streaming scenario's 30x CPU throttle is a deterministic stress profile, not a simulated end-user device.

Benchmarks do not assert machine-dependent performance budgets. Streaming processes 160 deltas by default and reports renderer-observed completion time, throughput, RAF callback-gap distributions, frame-budget equivalents, and long tasks through final geometry settlement. Delta count and delivery batch are included in result context when overridden. These are main-thread callback diagnostics, not compositor presentation or dropped-frame measurements. Visual-only and geometry metrics are `null` when their probes are disabled. Tab metrics describe sampled DOM observations. Assertions verify scenario and metric collection completion. Repeated repaint states are run-length grouped, but every original observation timestamp is retained alongside raw mutation batches and layout shifts.

Committed smoke and regression tests continue to own correctness coverage for pagination, tab paint, context resize, collapse state, and composer spacing.

## Chrome traces

Set `OPENCODE_PERFORMANCE_TRACE_DIR` to emit a standard Chrome DevTools trace for every benchmark page automatically:

```sh
OPENCODE_PERFORMANCE_TRACE_DIR=/tmp/opencode-performance-traces \
bunx playwright test --config e2e/performance/playwright.config.ts \
  timeline/session-tab-switch-benchmark.spec.ts
```

The emitted JSON is a standard Chrome trace and can be loaded directly into the Chrome DevTools Performance panel. `devtools-tracing` can optionally inspect it from the command line without adding package scripts or dependencies:

Trace capture mirrors [Puppeteer's official tracing defaults and lifecycle](https://pptr.dev/api/puppeteer.tracing), using Chrome's `ReturnAsStream` transfer mode and failing when Chromium reports trace data loss.

```sh
bunx devtools-tracing stats <trace-path-from-BENCHMARK_PAGE>
```

INP analysis requires a trace with a supported navigation/interaction insight. Selector statistics require a trace captured with `OPENCODE_PERFORMANCE_SELECTOR_TRACE=1`.

`e2e/performance/playwright.uncapped.config.ts` disables Chromium frame-rate limiting for explicit uncapped diagnostics. Native product benchmarks should use the default Playwright configuration.
