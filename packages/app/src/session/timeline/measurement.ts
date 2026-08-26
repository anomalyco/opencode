import type { Virtualizer } from "@tanstack/solid-virtual"

export function remeasureTimeline(
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  content: HTMLDivElement | undefined,
) {
  virtualizer.measure()
  virtualizer.getVirtualItems()
  content?.querySelectorAll<HTMLDivElement>("[data-index]").forEach((element) => virtualizer.measureElement(element))
}
