# Timeline Layout Continuity

Run from `packages/app`:

```sh
bun run test:stability
```

The suite runs a production build in one Chromium worker. Selected scenarios use deterministic 4x CPU stress after application readiness. This is a stress profile, not emulation of a specific device.

## What It Proves

The continuity probe samples DOM-derived layout and visibility state across browser render opportunities. Tests declare explicit contracts such as:

- Preserve a visible semantic anchor while the user is away from the bottom.
- Preserve end anchoring while active content grows or new content appears.
- Keep adjacent visible rows ordered without material overlap.
- Keep user-selected disclosure state through updates and virtualization.
- Avoid a sampled blank interval while one visible surface replaces another.
- Preserve logical row and control identity where local state or focus depends on it.
- Keep keyboard, wheel, and nested-scroll ownership consistent during remeasurement.

The suite exercises real browser reducer, projection, component, virtualizer, layout, focus, and interaction code. The backend and event producer are controlled fixtures.

## What It Does Not Prove

The pass/fail oracle does not inspect every compositor-presented pixel. A sample taken after `requestAnimationFrame` is a DOM/layout observation, not proof that every sampled state was displayed or that every displayed frame was sampled.

The suite does not provide complete coverage for:

- Compositor-only or raster-only glitches.
- Color, contrast, canvas, WebGL, masks, irregular clips, or arbitrary occlusion.
- Physical display refresh rates, native OS scaling, or a named low-end device.
- TCP packetization, proxy buffering, or the complete real server/provider pipeline.

Playwright video, trace, screenshots, and observation JSON are diagnostic evidence. They are not pixel baselines and do not participate in normal pass/fail decisions.

For optional before/violation/after screenshots, set `OPENCODE_STABILITY_CAPTURE=1`. Capture is opt-in because compositor readback can perturb timing.

## Test Layers

- **Projection:** admitted rows, grouping, labels, and final visible states.
- **Local state:** disclosure state, identity, duplicate delivery, and virtualization restoration.
- **Interaction:** wheel, keyboard, nested scrolling, actionability, and focus behavior.
- **Layout continuity:** anchoring, adjacency, responsive reflow, and visible surface handoffs.
- **Reducer hardening:** validly shaped but intentionally reordered, duplicated, removed, or replaced events.
- **Oracle contract:** pure analyzer and browser sampler calibration tests.

Production-lifecycle fixtures should model states emitted by the current producer. Impossible or reordered sequences belong in reducer-hardening tests and must not be described as normal provider behavior.

## Diagnostics

Failures retain:

- `video.webm`
- `trace.zip`
- failure screenshot
- sampled DOM/layout trace JSON
- event markers and summarized violations

The analyzer records both unclipped layout bounds and ancestor-clipped visible intersections. Scrollbar and raw `scrollTop` changes alone do not fail continuity checks; user-visible semantic anchor movement does.
