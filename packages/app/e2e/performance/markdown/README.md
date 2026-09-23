# Timeline Preload Lifetime

This manual benchmark uses the production app, restored session tabs, the real
`MessageTimeline` preload, and the real Markdown worker. Only API data and result
delivery timing are fixture-owned. It does not connect to a running OpenCode
service or send prompts.

From `packages/app`, set absolute `MARKDOWN_APP_BUILD_DIR` and
`MARKDOWN_RESULTS_DIR` artifact paths, then run:

```sh
bun run build
# Copy dist into MARKDOWN_APP_BUILD_DIR before editing production source.
bun --bun x playwright test --config e2e/performance/markdown/playwright.config.ts --repeat-each 20
```

Each isolated sample restores two sessions with one user message and one completed
assistant text part each. The cold target has a realistic recovery review with
either two TypeScript fences (typical) or 36 fences (large). The source has a short
completed answer. Target data is prefetched before selection, but its Markdown is
not parsed until the target is selected.

The app's service-worker generator reads `dist`, so use the normal build output
and freeze a copy, rather than overriding Vite's build output directory.

The real worker result is held after admission. The test selects the original
session again and releases the held result only after the abandoned timeline row
detaches and the selected answer reports production Markdown readiness. This
exercises both the timeline preload and the nested Markdown consumer, including
the case where either one would otherwise keep a shared parse alive.

Destination readiness and post-disposal result settlement are separate metrics.
The latter is a MessageChannel task after the result's promise microtasks drain.
The DOMParser probe counts actual DOMPurify input containing the abandoned answer
after disposal, in characters. CDP reports renderer task/script time and JS heap.
These are not worker CPU, Electron process RAM, or ungated tab-switch measurements.
In particular, this gate releases the result after destination readiness and must
not be used to claim a destination-readiness gain from skipping sanitization.

`MARKDOWN_ASSERT_DISPOSAL=1` enables the no-obsolete-sanitization assertion. Use
`MARKDOWN_RETAINED=1` only in separate post-GC runs. The repository trace collector
is available through `OPENCODE_PERFORMANCE_TRACE_DIR`, and `MARKDOWN_SCREENSHOT`
captures final output after timing. Run serially, preserve frozen builds, and keep
all results outside Git.
