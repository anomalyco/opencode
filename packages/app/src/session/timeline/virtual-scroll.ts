import type { Virtualizer } from "@tanstack/solid-virtual"

type TimelineVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

/**
 * TanStack's scroll to a target, while it runs: for up to five seconds it writes the target again in each frame that
 * a measurement has moved it. Each scroll is its own object. TanStack has no call for either of these. Its
 * declaration names the field, so a rename fails the type check, and `virtual-scroll.test.ts` drives a real
 * instance in case the field stays and its meaning changes.
 */
export function virtualScroll(virtualizer: TimelineVirtualizer): object | null {
  return virtualizer["scrollState"]
}

/** Ends that scroll, so that nothing writes its target again. */
export function stopVirtualScroll(virtualizer: TimelineVirtualizer) {
  virtualizer["scrollState"] = null
}
