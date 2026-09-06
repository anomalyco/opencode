# Completed Markdown Job Lifetime

This manual browser benchmark bundles the production `Markdown` component,
cache, sanitizer, and worker with Vite's production mode. It does not connect to
an OpenCode server or use user data. Run from `packages/session-ui`.

Set `MARKDOWN_BUILD_DIR` and `MARKDOWN_RESULTS_DIR` to absolute artifact directories:

```sh
bun --bun x vite build --config performance/markdown-lifetime/vite.config.ts
bun --bun x playwright test --config performance/markdown-lifetime/playwright.config.ts --repeat-each 20
```

The three independent scenarios render one deterministic long completed answer
with 36 TypeScript fences, explanatory prose, links, inline code, and tables:

- `mounted`: keep the consumer mounted through result delivery.
- `leave`: unmount the last consumer before delivering its parse result and render
  a short completed answer in the current destination.
- `shared`: unmount one of two consumers with the same cache key, preserving the
  other consumer's result.

The fixture intercepts only the real worker's message delivery. Admission and
worker-result arrival enable the Continue button. Continue disposes the departing
consumer, then delivers the held result. No parser work is replaced. This makes
the unmount/result ordering deterministic without wall-clock delays. Cold worker
startup and parsing happen before the measured interval; this benchmark measures
main-thread work after the worker has produced a result, not worker CPU savings.

Readiness is the production component's `data-markdown-ready` state, observed by
a MutationObserver. A MessageChannel task marks completion of the released
result's promise microtasks, including cache postprocessing. CDP reports renderer
task/script duration and renderer JS heap, not total browser or desktop RAM.
The cache-character metric confirms whether the obsolete result was sanitized and
stored. It is a mechanism check, not the performance result by itself.

The initial frozen baseline called this field `cacheBytes`, although it counted
HTML characters. The runner normalizes that frozen-build field to `cacheChars`;
the renderer probe operation is unchanged.

Use `MARKDOWN_ASSERT_DISPOSAL=1` to assert that the abandoned result is not cached.
Use `MARKDOWN_RETAINED=1` in separate runs for a post-GC retention check; do not mix
these samples with natural-GC heap measurements. `OPENCODE_PERFORMANCE_TRACE_DIR`
enables the repository's Chrome trace collector. `MARKDOWN_SCREENSHOT` optionally
captures each final scenario after timing. All artifacts belong outside Git.

Freeze the baseline build before changing production source and reuse the same
fixture, runtime, viewport, and readiness contracts for the candidate. Do not use
machine-dependent latency thresholds. The scenarios test real components, but do
not reproduce full session navigation or establish Electron process-memory gains.
