# T20: spinner tick phase

**TypeScript.** `SpinnerRenderable` ticks on the renderer's shared animation clock
(`renderer.onAnimationTick`, `@opentui/core` `renderer.ts`). Due times are multiples of the interval on the
renderer clock. Any frame within half an interval of a due time runs that tick, and slower subscribers wait
until the end of their window so they share frames with faster ones. A spinner can therefore advance up to half
an interval early, when another frame happens to be painted, or late, when it shares a frame.

**Rust.** `motion::Spinner` advances on an app interval timer started with the widget: exactly one frame per
interval from the moment it starts, independent of other frames.

**Reason.** The half-interval window is how OpenTUI's TypeScript renderer batches frames across many live
renderables under a JavaScript event loop. The visible motion is the same (one glyph per interval). The
oracle (`parity/component/U.6-motion.tsx`) samples stepped spinners at multiples of their interval, where
both agree.
