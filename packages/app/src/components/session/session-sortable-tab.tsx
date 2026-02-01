import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { getFilename } from "@opencode-ai/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <FileIcon
        node={{ path: props.path, type: "file" }}
        classList={{
          "grayscale-100 group-data-[selected]/tab:grayscale-0": !props.active,
          "grayscale-0": props.active,
        }}
      />
      <span class="text-14-medium truncate">{getFilename(props.path)}</span>
    </div>
  )
}

export function SortableTab(props: { tab: string; onTabClose: (tab: string) => void }): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))

  const handleClick = (e: MouseEvent) => {
    const trigger = e.currentTarget as HTMLElement
    const wrapper = trigger.closest('[data-slot="tabs-trigger-wrapper"]') as HTMLElement | null
    if (!wrapper) return

    const list = wrapper.closest('[data-slot="tabs-list"]') as HTMLElement | null
    if (!list) return

    const stickyButton = list.querySelector('[data-slot="sticky-add-button"]') as HTMLElement | null
    const stickyWidth = stickyButton?.offsetWidth ?? 0

    const wrapperRect = wrapper.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()

    // Check if tab is partially or fully hidden on the right side (accounting for sticky button)
    if (wrapperRect.right > listRect.right - stickyWidth) {
      // Scroll just enough to make the right edge visible (minus sticky button width)
      const overflow = wrapperRect.right - (listRect.right - stickyWidth)
      list.scrollLeft += overflow
    }
    // Check if tab is partially or fully hidden on the left side
    else if (wrapperRect.left < listRect.left) {
      // Scroll just enough to make the left edge visible
      const overflow = listRect.left - wrapperRect.left
      list.scrollLeft -= overflow
    }
  }

  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <Tooltip value={language.t("common.closeTab")} placement="bottom">
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => props.onTabClose(props.tab)}
                aria-label={language.t("common.closeTab")}
              />
            </Tooltip>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
          onClick={handleClick}
        >
          <Show when={path()}>{(p) => <FileVisual path={p()} />}</Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
