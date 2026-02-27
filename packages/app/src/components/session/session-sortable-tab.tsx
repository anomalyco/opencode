import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { showToast } from "@opencode-ai/ui/toast"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { Tabs } from "@opencode-ai/ui/tabs"
import { getFilename } from "@opencode-ai/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useCommand } from "@/context/command"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { copyFile } from "@/utils/file-copy"

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
  const command = useCommand()
  const platform = usePlatform()
  const server = useServer()
  const sdk = useSDK()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  const local = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const absolute = createMemo(() => {
    const value = path()
    if (!value) return
    const root = sdk.directory.replace(/[\\/]+$/, "")
    const next = value.replace(/^[\\/]+/, "")
    if (root.includes("\\") && !root.includes("/")) return `${root}\\${next.replaceAll("/", "\\")}`
    return `${root}/${next}`
  })
  const content = createMemo(() => {
    const value = path()
    if (!value) return
    return <FileVisual path={value} />
  })

  const fail = (error: unknown) => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : undefined,
    })
  }
  const done = (value: string) => {
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("session.share.copy.copied"),
      description: value,
    })
  }
  const text = (value: string) => navigator.clipboard.writeText(value).then(() => done(value), fail)
  const parent = (value: string) => {
    const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"))
    if (index === -1) return value
    return value.slice(0, index)
  }

  const copy = () => {
    const value = path()
    if (!value) return
    void copyFile({
      path: value,
      load: file.load,
      get: file.get,
      copied: language.t("toast.file.copy.success.title"),
      failed: language.t("toast.file.copy.failed.title"),
      binary: language.t("toast.file.copy.binary.title"),
      binaryDescription: language.t("toast.file.copy.binary.description"),
    })
  }

  const reveal = () => {
    const value = absolute()
    if (!value) return
    if (!local()) return
    void platform.openPath!(parent(value)).catch(fail)
  }

  const open = () => {
    const value = absolute()
    if (!value) return
    if (!local()) return
    void platform.openPath!(value).catch(fail)
  }

  const relative = () => {
    const value = path()
    if (!value) return
    void text(value)
  }

  const absolutePath = () => {
    const value = absolute()
    if (!value) return
    void text(value)
  }

  return (
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <ContextMenu>
          <ContextMenu.Trigger asChild>
            <Tabs.Trigger
              value={props.tab}
              closeButton={
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
                    onClick={() => props.onTabClose(props.tab)}
                    aria-label={language.t("common.closeTab")}
                  />
                </TooltipKeybind>
              }
              hideCloseButton
              onMiddleClick={() => props.onTabClose(props.tab)}
            >
              <Show when={content()}>{(value) => value()}</Show>
            </Tabs.Trigger>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content>
              <ContextMenu.Item onSelect={relative}>
                <div class="flex size-5 shrink-0 items-center justify-center">
                  <Icon name="copy" size="small" class="text-icon-weak" />
                </div>
                <ContextMenu.ItemLabel>{language.t("session.files.copyRelativePath")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Item onSelect={absolutePath}>
                <div class="flex size-5 shrink-0 items-center justify-center">
                  <Icon name="copy" size="small" class="text-icon-weak" />
                </div>
                <ContextMenu.ItemLabel>{language.t("session.files.copyAbsolutePath")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item onSelect={copy}>
                <div class="flex size-5 shrink-0 items-center justify-center">
                  <Icon name="copy" size="small" class="text-icon-weak" />
                </div>
                <ContextMenu.ItemLabel>{language.t("session.files.copyContents")}</ContextMenu.ItemLabel>
              </ContextMenu.Item>
              <Show when={local()}>
                <>
                  <ContextMenu.Separator />
                  <ContextMenu.Item onSelect={reveal}>
                    <div class="flex size-5 shrink-0 items-center justify-center">
                      <Icon name="folder" size="small" class="text-icon-weak" />
                    </div>
                    <ContextMenu.ItemLabel>{language.t("session.files.revealInFileManager")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                  <ContextMenu.Item onSelect={open}>
                    <div class="flex size-5 shrink-0 items-center justify-center">
                      <Icon name="folder" size="small" class="text-icon-weak" />
                    </div>
                    <ContextMenu.ItemLabel>{language.t("session.files.openInDefaultApp")}</ContextMenu.ItemLabel>
                  </ContextMenu.Item>
                </>
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu>
      </div>
    </div>
  )
}
