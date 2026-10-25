# Composer image paste benchmark

This opt-in benchmark renders the production composer, attachment paste handler, draft store,
and persistence. It pastes synthetic images and immediately types 228 characters without sending
a prompt. It never calls a model or uploads an attachment.

Run from `packages/app`, using the repository's pinned Bun version. Fixture generation needs
Python and Pillow; the browser run needs Chrome installed. Keep generated images, builds, and
results outside the checkout.

```sh
python e2e/performance/composer-images/generate-fixtures.py /tmp/composer-images/fixtures
OPENCODE_IMAGE_BUILD=/tmp/composer-images/build bun x vite build --config e2e/performance/composer-images/vite.config.ts
OPENCODE_IMAGE_BUILD=/tmp/composer-images/build bun x vite preview --config e2e/performance/composer-images/vite.config.ts --host 127.0.0.1 --port 4784
```

In another terminal, from `packages/app`:

```sh
OPENCODE_IMAGE_FIXTURES=/tmp/composer-images/fixtures OPENCODE_IMAGE_OUTPUT=/tmp/composer-images/results bun x playwright test --config e2e/performance/composer-images/playwright.config.ts --repeat-each=3
```

On PowerShell, set each environment variable with `$env:NAME = 'value'` before the command.
`OPENCODE_IMAGE_URL` can select a second build served on a different port. Compare separate
production builds, run one browser worker at a time, and alternate baseline and patch runs.
For diagnosis only, `OPENCODE_IMAGE_PREVIEW=off` at build time omits the preview image source
while retaining the real attachment and draft paths.

The large case uses three JPEGs: 17901 × 10654, 8858 × 7228, and 8858 × 7228 pixels. The small
control uses one 1440 × 900 JPEG. All fixtures contain generated colored rectangles.

Each run writes `metrics.json` and `composer.png`. Metrics include raw animation-frame intervals,
main-thread long tasks, Event Timing durations, and the elapsed time for paste plus typing.
The typing delay is 12 ms per character, so elapsed time includes intentional pacing and browser
automation overhead. Frame p95 and maximum event duration are diagnostics, not INP measurements.
There are no wall-clock assertions: correctness checks cover retained text, attachment count,
removal, and continued editing.

The harness dispatches a `ClipboardEvent` with browser File objects through the production paste
handler. It does not cover native Windows clipboard extraction, packaged desktop IPC, or peak
process memory. The separate `regression/composer.spec.ts` keeper case checks bounded preview
dimensions, focus, draft restoration, full-size preview, and submission of the original bytes.
