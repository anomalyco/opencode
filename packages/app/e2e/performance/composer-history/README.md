# Composer History Hydration

Manual benchmark for an empty destination composer. Runs the production
`ComposerEditor`, `createComposerEditor`, `createComposerHistory`, persistence
codec, and browser IndexedDB draft store. It does not run the surrounding app
shell or native desktop IPC.

Workload: 100 normal prompts with realistic review instructions/code and 100
shell commands. Separate cases have no images, 50 unique screenshots, or 50
references to 5 screenshots. The fixture generates valid 1440 x 900 PNG code
screenshots before timing and reports their exact byte sizes. Each isolated
browser context measures a cold URL-cache mount followed by a warm remount.
The database was just seeded; this does not simulate a cold disk cache.

`historyReadyMs` measures the mount action until both production history stores
are populated. This is history availability, not time to first editable input
(input can be usable before history finishes). The benchmark then verifies
ArrowUp recall and a decoded screenshot in the real editor. `recallObservedMs`
includes Playwright action/assertion overhead and is reported separately.
`mountRecallObservedMs` includes the mount, readiness checks, keyboard action,
and correct text/image completion; it also includes Playwright overhead.
IndexedDB reads and blob sizes are mechanism metrics, not desktop IPC bytes or
process memory. No timing threshold is enforced.

From `packages/app`, set `OPENCODE_HISTORY_BUILD` and
`OPENCODE_HISTORY_OUTPUT` to artifact directories outside Git, then run:

```sh
bun x vite build --config e2e/performance/composer-history/vite.config.ts
bun x playwright test --config e2e/performance/composer-history/playwright.config.ts --repeat-each=20
```

The preview server owns port 4783 and is stopped by Playwright. Preserve each
build and its revision/hash for comparisons. `BENCHMARK` JSON lines contain all
raw samples. Optional Chrome traces use the existing
`OPENCODE_PERFORMANCE_TRACE_DIR` setting; keep trace runs separate from clean
timing. Screenshots are captured after timing on the first repeat only.
