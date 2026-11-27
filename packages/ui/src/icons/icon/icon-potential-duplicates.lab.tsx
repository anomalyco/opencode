import { For } from "solid-js"
import type { artworkNames } from "../catalog"
import { Icon } from "./icon"

type ArtworkName = ReturnType<typeof artworkNames>[number]

const pairs = [
  ["photo", "outline-photo"],
  ["share", "outline-share"],
  ["selector", "chevron-grabber-vertical"],
  ["arrow-up-right", "outline-arrow-up-right"],
  ["open-file", "outline-square-arrow"],
  ["refresh", "outline-rotate-clockwise"],
] satisfies [ArtworkName, ArtworkName][]

export default {
  title: "App/Design review/Potential duplicate icons",
  id: "ui-potential-duplicate-icons",
}

export const Comparison = {
  render: () => (
    <section class="flex w-full max-w-2xl flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h2 class="text-14-medium text-v2-text-text-base">Potential duplicate icons · {pairs.length} pairs</h2>
        <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
          These pairs look similar and each icon has its own SVG artwork.
        </p>
      </div>
      <ul class="divide-y divide-v2-border-border-base">
        <For each={pairs}>
          {(pair) => (
            <li class="grid grid-cols-2 gap-3 py-3 text-v2-text-text-base">
              <For each={pair}>
                {(name) => (
                  <div class="flex min-w-0 items-center gap-2">
                    <Icon name={name} class="shrink-0" />
                    <bdi class="min-w-0 text-12-mono [overflow-wrap:anywhere]">{name}</bdi>
                  </div>
                )}
              </For>
            </li>
          )}
        </For>
      </ul>
    </section>
  ),
}
