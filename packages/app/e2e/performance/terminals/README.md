# Native Terminal Benchmark

Manual Windows benchmark. Run only in an isolated development worktree. It does
not connect to an OpenCode service, user profile, or database.

Build from `packages/app` with
`bun x vite build --config e2e/performance/terminals/vite.config.ts`, then freeze
`dist` outside the repository. Set `PLAYWRIGHT_BUILD=1`, `PLAYWRIGHT_BASE_URL` to
an unused loopback URL, `TERMINAL_BUILD` to the frozen build,
`TERMINAL_ARTIFACTS` to an existing external directory, and `TERMINAL_RESULTS`
to an external result directory. Run:

```sh
bun x playwright test --config e2e/performance/terminals/playwright.config.ts --repeat-each=20
```

The runner owns its preview server and each test owns a PowerShell ConPTY process.
Session metadata is deterministic. Native output is forwarded through Playwright's
WebSocket fixture into the real production `Terminal`, writer, Ghostty WASM/canvas,
and serializer. No output is dropped, paused, or delayed. This is native terminal
plus production renderer evidence, not the production PTY backend or Electron IPC.

The workload is 12,000 colored build/test log lines with file paths, durations, and
result descriptions. Cases separate visible output, the same output while hidden,
and closing the session tab after filling the configured scrollback. Ghostty
converts the app's 10,000-line setting to bytes at its initial 80-column width;
resizing reduces the effective row capacity. The report records actual retained
rows and the first retained fixture record rather than assuming 10,000 rows. Completion
requires the final marker in Ghostty and completion of its write callbacks, not
just WebSocket delivery. Teardown requires Home readiness and the final serialized
snapshot. Input, focus, resizing, and native process survival are checked.

`probe.ts` is included only by this benchmark build. It observes actual writes,
renderer calls, and serialization. Chrome `TaskDuration` measures renderer task
time, not total process CPU or RAM. For attribution, set
`OPENCODE_PERFORMANCE_TRACE_DIR`; keep traced runs separate from clean timing.
`TERMINAL_DRAW_PROBE=1` separately counts actual canvas draws to verify hidden
rendering; do not mix these instrumented samples with clean timing.
Use `TERMINAL_REVISION` and `TERMINAL_BUNDLE` to identify frozen artifacts.
`TERMINAL_SCREENSHOTS` captures the visible result after timing.

The benchmark has no machine-dependent performance thresholds. Keep raw logs,
snapshots, traces, and screenshots outside Git. Run heavy work through the
coordinator's exclusive gate when participating in a shared performance wave.
