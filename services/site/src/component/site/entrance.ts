// When an entrance plays. Kept apart from reveal.ts so marks that animate in (the footer wordmark)
// can share the rule without the reveal styles.

// An entrance starts once this much of its container is on screen, at load or on scroll, and above
// the bottom 15% of the window: at the very edge it would play mid-scroll, before anyone looks.
export const washThreshold = 0.3
export const washRootMargin = "0px 0px -15% 0px"

// The first observer notification comes right after the page's code runs. Already in view then,
// an entrance waits this long, so it plays after first paint rather than while the page settles.
export function washStartTime(first: boolean) {
  return performance.now() + (first ? 300 : 0)
}

// The observer's first notification comes at once and calls anything partly on screen
// intersecting, so the share on screen is checked too.
export function inView(entry: IntersectionObserverEntry) {
  return entry.isIntersecting && entry.intersectionRatio >= washThreshold
}
