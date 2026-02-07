import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { getFilename } from "@opencode-ai/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"

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

export function SortableTab(props: {
  tab: string
  onTabClose: (tab: string) => void
  onClick?: () => void
  onCloseOthers?: (tab: string) => void
  onMention?: (tab: string) => void
}): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <ContextMenu>
          <ContextMenu.Trigger
            as={Tabs.Trigger}
            value={props.tab}
            closeButton={
              <TooltipKeybind
                title={language.t("common.closeTab")}
                keybind={command.keybind("tab.close")}
                placement="bottom"
              >
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  class="h-5 w-5"
                  onClick={() => props.onTabClose(props.tab)}
                  aria-label={language.t("common.closeTab")}
                />
              </TooltipKeybind>
            }
            hideCloseButton
            onMiddleClick={() => props.onTabClose(props.tab)}
            onClick={props.onClick}
          >
            <Show when={path()}>{(p) => <FileVisual path={p()} />}</Show>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item onSelect={() => props.onTabClose(props.tab)}>
                <ContextMenu.ItemLabel>{language.t("common.closeTab")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <Show when={props.onCloseOthers}>
                <ContextMenu.Item onSelect={() => props.onCloseOthers?.(props.tab)}>
                  <ContextMenu.ItemLabel>{language.t("session.tab.closeOthers")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
              <Show when={props.onMention}>
                <ContextMenu.Separator />
                <ContextMenu.Item onSelect={() => props.onMention?.(props.tab)}>
                  <ContextMenu.ItemLabel>{language.t("session.files.mention")}</ContextMenu.ItemLabel>
                </ContextMenu.Item>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
      </div>
    </div>
  )
}
