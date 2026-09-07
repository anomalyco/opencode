# Timeline Text Projection Benchmark

Run from `packages/app`, against a production bundle. No OpenCode server is needed.
The fixture owns its HTTP event source and mocks all other API responses.

```sh
bun run build -- --config e2e/performance/timeline/projection.vite.config.ts
PLAYWRIGHT_BUILD=1 playwright test --config e2e/performance/timeline/projection.playwright.config.ts --repeat-each=20 --workers=1 --retries=0 --reporter=line
```

Set `PLAYWRIGHT_PORT` to an unused local port. Set `PROJECTION_BUNDLE` to preview a
previously frozen bundle, `PROJECTION_OUTPUT` for test artifacts, and
`PROJECTION_REVISION` to label results. Keep all three workloads separate:
40 historical user/assistant pairs, 320 pairs, and 320 pairs with six additional
completed read tools per assistant. The existing mixed fixture includes Markdown,
reasoning, and edit/write/patch output. Results include serialized history bytes,
message/part counts, and event bytes.

Each case opens the real application timeline with a busy session, waits for the
initial Markdown to be ready, then sends the same 160 text deltas at a 25 ms source
cadence. The Node HTTP source does not wait for renderer acknowledgements. Results
retain every source emission time and animation-frame interval. Completion means
the final marker is in ready Markdown and has reached an animation-frame callback;
it does not claim a compositor presentation timestamp. Row replacements count the
active streaming row, not normal virtualizer mounts while scrolling.

Use `PROJECTION_COUNTERS=1` for separate diagnostic runs. The benchmark build
instruments the full-history constructor with its call count, input entries visited,
and synchronous elapsed time. The probe is absent from normal builds and disabled
in clean timing runs. `OPENCODE_PERFORMANCE_TRACE_DIR` enables the existing Chrome
trace collector. Set `PROJECTION_SCREENSHOT` to an output path prefix for screenshots
after timing. Do not compare diagnostic timing with clean timing.
