import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { FileVisual } from "./session-sortable-tab"

export function SortableTabV2(props: { tab: string; onTabClose: (tab: string) => void }): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} textClass="truncate" />
  })
  return (
    <div use:sortable class="flex shrink-0 items-center" classList={{ "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative">
        <TabsV2.Trigger value={props.tab} onMiddleClick={() => props.onTabClose(props.tab)}>
          <Show when={content()}>{(value) => value()}</Show>
          <TooltipKeybind
            title={language.t("common.closeTab")}
            keybind={command.keybind("tab.close")}
            placement="bottom"
            gutter={10}
          >
            <TabsV2.CloseButton onClick={() => props.onTabClose(props.tab)} />
          </TooltipKeybind>
        </TabsV2.Trigger>
      </div>
    </div>
  )
}
