// The logo fan's motion (logo-fan.tsx), shared with the section menus' fan style (docs-lockup.tsx)
// and the press gallery, in its own module so they don't load the fan.

// Each item drops a little further than the one above it (12px, then 6px more per item, up to
// 42px), so the column cascades without any item travelling far. Items also start a touch small
// and turned, and settle square.
const drop = (index: number) => Math.min(12 + index * 6, 42)
const start = (index: number) => `translateY(-${drop(index)}px) rotate(-1deg) scale(0.97)`
const rest = "translateY(0px) rotate(0deg) scale(1)"
const stagger = 32

// A tight damped spring (about 7% overshoot, no visible second settle), sampled for linear().
const spring = `linear(${Array.from({ length: 48 }, (_, index) => {
  const t = index / 47
  const damping = 0.65
  const frequency = 11
  const damped = frequency * Math.sqrt(1 - damping * damping)
  const value =
    1 -
    Math.exp(-damping * frequency * t) *
      (Math.cos(damped * t) + ((damping * frequency) / damped) * Math.sin(damped * t))
  return index === 47 ? "1" : value.toFixed(4)
}).join(", ")})`

export const fanMotion = { start, rest, stagger, spring }
