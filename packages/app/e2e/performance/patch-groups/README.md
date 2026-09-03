# Patch Group Benchmark

This manual benchmark mounts the production `CurrentFileToolGroup` and `File`
components with completed edit results. A separate case mounts `ToolDisplay`
with a patch result. It uses four real Core tool source files, with deterministic
identifier renames, rather than repeated filler. It does not connect to a server.

From `packages/app`, set `PATCH_BUILD_DIR` and `PATCH_RESULTS_DIR` to external
artifact directories, then run:

```sh
bun x vite build --config e2e/performance/patch-groups/vite.config.ts
bun x playwright test --config e2e/performance/patch-groups/playwright.config.ts --repeat-each=20
```

Run under the shared exclusive gate when collecting measurements on a shared
machine. The Playwright-owned static server uses `PATCH_PORT` (default 4317),
refuses to reuse an existing server, and shuts down after the run.

Each fresh browser context measures a cold collapsed mount, a warm remount,
and opening `edit.ts` through its real accordion. Mount timing covers synchronous
component construction through layout. Expansion timing starts at the click and
ends at the production file renderer's `onRendered` callback. Assertions check
the exact file count, collapsed state, and completed file rendering. Results
include payload bytes, source bytes, file/tool counts, and supporting warm
`patchFileGroups` timings with and without reading views. No timing thresholds
are enforced. This is a browser component workload, not a full desktop memory test.

Freeze the build before changing production code. Use the same fixture, browser,
viewport, sample count, and completion checks for both revisions.

`PATCH_REVISION=<git-sha>` loads the grouping module and tool renderer from that
revision at build time without changing the worktree. This is useful when fixing
the harness after freezing a baseline. All other production sources must match
between revisions; this switch only covers those two measured modules.

For a separate diagnostic build, set `PATCH_COUNTERS=1`. Its build-only transform
counts grouping, normalization, reconstruction, and line-diff calls with User
Timing marks. Do not mix instrumented results with clean timings. Set
`OPENCODE_PERFORMANCE_TRACE_DIR` for the existing Chrome trace collector, and
`PATCH_SCREENSHOTS=1` for collapsed/expanded screenshots after measurement.
