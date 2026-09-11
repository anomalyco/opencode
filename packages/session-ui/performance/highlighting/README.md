# Diff Highlighting

Manual Chromium benchmark of the production `File` component, `normalize`, Pierre
pool, and bundled workers. No OpenCode server, session, or stored data is used.

From `packages/session-ui`, set `HIGHLIGHT_BUNDLE` to an external artifact
directory, then run:

```sh
bun performance/highlighting/build.ts
bun x playwright test --config performance/highlighting/playwright.config.ts --repeat-each 20
```

Each isolated page measures a cold mount, unmount/remount of the identical patch,
and an edited patch under the same filename. The fixtures contain 120 or 1,200
TypeScript route handlers with one changed line per ten handlers. Exact byte and
line counts, bundle hash, source revision, and individual samples are reported
through the existing performance reporter.

`readyMs` ends when the viewer has called `onRendered`, its pool has settled,
and `onPostRender` has committed the final worker result containing the expected
edit. `firstReadyMs` records the earlier production callback, which can represent
plain first paint. Worker request counts and round-trip time describe the
mechanism, not CPU time or desktop memory. Full reconstructed content is checked
separately after timing. No forced GC or machine-dependent thresholds are used.

`HIGHLIGHT_CORRECTNESS=1` runs the deterministic `*.correctness.ts` checks against
the same fixture instead of the timed benchmarks: cache reuse across remounts,
invalidation on content, theme, and worker option changes, and plain rendering of
large diffs with complete reconstructed content.

Optional output settings: `HIGHLIGHT_RESULTS`, `HIGHLIGHT_SCREENSHOTS`,
`OPENCODE_PERFORMANCE_RUN_ID`, and `OPENCODE_PERFORMANCE_TRACE_DIR` (separate
diagnostic runs, not clean timing). `HIGHLIGHT_PORT` defaults to 4793. Preserve the
baseline build before product edits, then point `HIGHLIGHT_BUNDLE` at either frozen
build to compare the same workload without rebuilding.

`HIGHLIGHT_RETENTION=1` enables a separate post-unmount, forced-GC renderer-isolate
heap diagnostic. Do not use that run for timing or describe it as desktop RAM;
it excludes worker heaps and native/browser-process memory.
