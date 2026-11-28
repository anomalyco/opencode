import { For } from "solid-js"
import { unusedDesktopIcons } from "./icon-usage-data"
import { Icon } from "./icon"

export default {
  title: "App/Design review/Unused icons",
  id: "ui-unused-icons",
}

export const Desktop = {
  render: () => (
    <section class="flex w-full max-w-2xl flex-col gap-3">
      <div class="flex flex-col gap-1">
        <h2 class="text-14-medium text-v2-text-text-base">Unused desktop icons · {unusedDesktopIcons.length}</h2>
        <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
          Built-in desktop screens don’t use these icons. Pages and installed plugins can still render them.
        </p>
      </div>
      <ul
        data-scrollable
        class="grid max-h-[70vh] grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-1 overflow-auto"
      >
        <For each={unusedDesktopIcons}>
          {(name) => (
            <li class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-v2-text-text-base">
              <Icon name={name} class="shrink-0" />
              <bdi class="min-w-0 break-words text-12-mono">{name}</bdi>
            </li>
          )}
        </For>
      </ul>
    </section>
  ),
}
