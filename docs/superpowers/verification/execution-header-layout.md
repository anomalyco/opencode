# Execution header layout verification (2026-09-23)

Production benchmarks ran serially from `packages/app` with the existing Playwright production-build configuration (`PLAYWRIGHT_BUILD=1`, Chromium, 20 repeats per scenario, one worker). The before logs and after logs are retained in the ignored `.superpowers/sdd/2026-09-22-execution-header-layout/` ledger directory.

| Scenario | Before median first correct | After median first correct | Before median stable | After median stable |
| --- | ---: | ---: | ---: | ---: |
| Tab switch, cold, review closed | 332.35 ms | 311.05 ms | 352.25 ms | 337.10 ms |
| Tab switch, cold, review open | 378.95 ms | 363.20 ms | 416.75 ms | 390.95 ms |
| Tab switch, warm, review closed | 58.15 ms | 50.80 ms | 178.70 ms | 169.30 ms |
| Tab switch, warm, review open | 106.10 ms | 96.20 ms | 194.90 ms | 182.30 ms |
| Tab switch, warm, review resized | 144.55 ms | 123.30 ms | 268.70 ms | 237.40 ms |

`bun run bench:tabs` passed all 100 cases before and after. `bun run bench:entry` passed the 20 cold-session cases both times (first-correct medians 683.25 ms before, 604.60 ms after). The same 40 new-session cases failed both times at `session-entry-benchmark.spec.ts:47` because the benchmark expected no writes; this was present before editing the session code. Benchmark timing is diagnostic, not a machine-independent performance threshold.

`bun run test:components -- component-tests/superpowers.spec.ts --workers=2` passed all 120 cases after extending the Storybook layout/file mocks to expose side and terminal states. Root `bun run check` passed (36/36 typecheck tasks). The production-backed fixture exercises measured geometry in the timeline, side-panel, and loaded side-terminal headers, including a 520px active panel within a desktop viewport and a compact-to-wide-to-compact transition. The terminal loading fallback was not directly exercised by this fixture. No installed client was verified and no running app/server was restarted.
