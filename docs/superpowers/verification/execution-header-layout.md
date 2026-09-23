# Execution header layout verification (2026-09-23)

Production benchmarks ran serially from `packages/app` with the existing Playwright production-build configuration (`PLAYWRIGHT_BUILD=1`, Chromium, 20 repeats per scenario, one worker). The before logs and after logs are retained in the ignored `.superpowers/sdd/2026-09-22-execution-header-layout/` ledger directory.

| Scenario | Before median first correct | After median first correct | Before median stable | After median stable |
| --- | ---: | ---: | ---: | ---: |
| Tab switch, cold, review closed | 332.35 ms | 302.80 ms | 352.25 ms | 335.80 ms |
| Tab switch, cold, review open | 378.95 ms | 337.85 ms | 416.75 ms | 383.70 ms |
| Tab switch, warm, review closed | 58.15 ms | 52.45 ms | 178.70 ms | 166.15 ms |
| Tab switch, warm, review open | 106.10 ms | 95.85 ms | 194.90 ms | 190.45 ms |
| Tab switch, warm, review resized | 144.55 ms | 126.20 ms | 268.70 ms | 236.90 ms |

`bun run bench:tabs` passed all 100 cases before and in the final post-change run. `bun run bench:entry` passed the 20 cold-session cases both times (first-correct medians 683.25 ms before, 612.85 ms in the final run). The same 40 new-session cases failed both times at `session-entry-benchmark.spec.ts:47` because the benchmark expected no writes; this was present before editing the session code. Benchmark timing is diagnostic, not a machine-independent performance threshold.

`bun run test:components -- component-tests/superpowers.spec.ts --workers=2` passed all 122 cases after the file-tree follow-up and the side/terminal button-intersection assertions. Root `bun run check` passed (36/36 typecheck tasks); reporting package tests passed 124 with one pre-existing host-only skip. The production-backed fixture exercises measured geometry in the timeline, side-panel, loaded side-terminal, and file-tree headers in LTR/RTL, including a 520px active panel within a desktop viewport and a compact-to-wide-to-compact transition. The terminal loading fallback was not directly exercised by this fixture. No installed client was verified and no running app/server was restarted.

The packaged reporting skill/README contract tests pass. A controlled root-controller probe with `execution_read` and `execution_report` unavailable paused before implementation or dispatch; it did not exercise the success path. The installed reporting tools are not available in this controller's tool catalog, and `opencode service status` is unavailable in this shell (`opencode: command not found`). The installation-wide controller policy was therefore not activated and live Map registration remains unverified.
