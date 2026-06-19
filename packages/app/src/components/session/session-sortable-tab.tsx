import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { getFilename } from "@opencode-ai/core/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { useSessionLayout } from "@/pages/session/session-layout"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5 min-w-0">
      <Show
        when={!props.active}
        fallback={<FileIcon node={{ path: props.path, type: "file" }} class="size-4 shrink-0" />}
      >
        <span class="relative inline-flex size-4 shrink-0">
          <FileIcon node={{ path: props.path, type: "file" }} class="absolute inset-0 size-4 tab-fileicon-color" />
          <FileIcon node={{ path: props.path, type: "file" }} mono class="absolute inset-0 size-4 tab-fileicon-mono" />
        </span>
      </Show>
      <span class="text-14-medium truncate">{getFilename(props.path)}</span>
    </div>
  )
}

export function SortableTab(props: { tab: string; onTabClose: (tab: string) => void }): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const { tabs } = useSessionLayout()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const dirty = createMemo(() => tabs().dirty(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} />
  })
  return (
    <div use:sortable class="h-full flex items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative group">
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <span class="relative inline-flex size-5 items-center justify-center">
              <Show when={dirty()}>
                <span
                  aria-label={language.t("common.unsavedChanges")}
                  class="absolute inline-block size-2 rounded-full bg-text-weak group-hover:opacity-0"
                />
              </Show>
              <TooltipKeybind
                title={language.t("common.closeTab")}
                keybind={command.keybind("tab.close")}
                placement="bottom"
                gutter={10}
              >
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  class="h-5 w-5"
                  classList={{ "opacity-0 group-hover:opacity-100": dirty() }}
                  onClick={() => props.onTabClose(props.tab)}
                  aria-label={language.t("common.closeTab")}
                />
              </TooltipKeybind>
            </span>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
        >
          <Show when={content()}>{(value) => value()}</Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
