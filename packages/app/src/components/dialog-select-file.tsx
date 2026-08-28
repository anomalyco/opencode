import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Keybind } from "@opencode-ai/ui/keybind"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createMemo, createSignal, lazy, Match, Show, Switch } from "solid-js"
import { formatKeybind } from "@/context/command"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useSessionLayout } from "@/pages/session/session-layout"
import { decode64 } from "@/utils/base64"
import { getRelativeTime } from "@/utils/time"
import {
  createCommandPaletteFileEntry,
  createCommandPaletteFileOpener,
  createCommandPaletteModel,
  uniqueCommandPaletteEntries,
  type CommandPaletteEntry,
} from "./command-palette"
import { DialogCommandPaletteV2 } from "./dialog-command-palette-v2"

const DialogSelectFileV2 = lazy(() =>
  import("./dialog-select-directory-v2").then((module) => ({ default: module.DialogSelectDirectoryV2 })),
)
type DialogSelectFileMode = "all" | "files"

export function DialogSelectFile(props: { mode?: DialogSelectFileMode; onOpenFile?: (path: string) => void }) {
  const platform = usePlatform()
  const settings = useSettings()
  const filesOnly = () => props.mode === "files"

  if (!filesOnly() && settings.general.newLayoutDesigns()) {
    return <DialogCommandPaletteV2 onOpenFile={props.onOpenFile} />
  }

  if (filesOnly() && platform.platform === "desktop" && settings.general.newLayoutDesigns()) {
    return <DialogSelectFileDesktopV2 onOpenFile={props.onOpenFile} />
  }

  return <DialogSelectFileLegacy filesOnly={filesOnly} onOpenFile={props.onOpenFile} />
}

function DialogSelectFileDesktopV2(props: { onOpenFile?: (path: string) => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const { params } = useSessionLayout()
  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const openFile = createCommandPaletteFileOpener(props.onOpenFile)

  return (
    <DialogSelectFileV2
      server={serverSDK().server}
      mode="file"
      start={projectDirectory()}
      title={language.t("session.header.searchFiles")}
      onSelect={(result) => {
        if (typeof result !== "string") return
        openFile(result)
      }}
    />
  )
}

function DialogSelectFileLegacy(props: { filesOnly: () => boolean; onOpenFile?: (path: string) => void }) {
  const palette = createCommandPaletteModel(props)
  const [grouped, setGrouped] = createSignal(false)

  const items = async (text: string) => {
    const query = text.trim()
    setGrouped(query.length > 0)

    if (!query && props.filesOnly()) {
      const loaded = palette.file.tree.state("")?.loaded
      const pending = loaded ? Promise.resolve() : palette.file.tree.list("")
      const next = uniqueCommandPaletteEntries([...palette.recentFileEntries(), ...palette.rootFileEntries()])

      if (loaded || next.length > 0) {
        void pending
        return next
      }

      await pending
      return uniqueCommandPaletteEntries([...palette.recentFileEntries(), ...palette.rootFileEntries()])
    }

    if (!query) return [...palette.preferredCommandEntries(), ...palette.recentFileEntries()]

    if (props.filesOnly()) {
      const files = await palette.file.searchFiles(query)
      const category = palette.language.t("palette.group.files")
      return files.map((path) => createCommandPaletteFileEntry(path, category))
    }

    const [files, nextSessions] = await Promise.all([
      palette.file.searchFiles(query),
      Promise.resolve(palette.sessions(query)),
    ])
    const category = palette.language.t("palette.group.files")
    const entries = files.map((path) => createCommandPaletteFileEntry(path, category))
    return [...palette.commandEntries(), ...nextSessions, ...entries]
  }

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        class="px-3"
        search={{
          placeholder: props.filesOnly()
            ? palette.language.t("session.header.searchFiles")
            : palette.language.t("palette.search.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={palette.language.t("palette.empty")}
        loadingMessage={palette.language.t("common.loading")}
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description", "category"]}
        skipFilter={(item) => item.type === "file"}
        groupBy={grouped() ? (item) => item.category : () => ""}
        onMove={(item: CommandPaletteEntry | undefined) => palette.highlight(item)}
        onSelect={(item: CommandPaletteEntry | undefined) => palette.select(item)}
      >
        {(item) => (
          <Switch
            fallback={
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.path ?? "", type: "file" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular">
                    <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {getDirectory(item.path ?? "")}
                    </span>
                    <span class="text-text-strong whitespace-nowrap">{getFilename(item.path ?? "")}</span>
                  </div>
                </div>
              </div>
            }
          >
            <Match when={item.type === "command"}>
              <div class="w-full flex items-center justify-between gap-4">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-14-regular text-text-strong whitespace-nowrap">{item.title}</span>
                  <Show when={item.description}>
                    <span class="text-14-regular text-text-weak truncate">{item.description}</span>
                  </Show>
                </div>
                <Show when={item.keybind}>
                  <Keybind class="rounded-[4px]">{formatKeybind(item.keybind ?? "", palette.language.t)}</Keybind>
                </Show>
              </div>
            </Match>
            <Match when={item.type === "session"}>
              <div class="w-full flex items-center justify-between rounded-md pl-1">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <Icon name="bubble-5" size="small" class="shrink-0 text-icon-weak" />
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="text-14-regular text-text-strong truncate"
                      classList={{ "opacity-70": !!item.archived }}
                    >
                      {item.title}
                    </span>
                    <Show when={item.description}>
                      <span
                        class="text-14-regular text-text-weak truncate"
                        classList={{ "opacity-70": !!item.archived }}
                      >
                        {item.description}
                      </span>
                    </Show>
                  </div>
                </div>
                <Show when={item.updated}>
                  <span class="text-12-regular text-text-weak whitespace-nowrap ml-2">
                    {getRelativeTime(new Date(item.updated!).toISOString(), palette.language.t)}
                  </span>
                </Show>
              </div>
            </Match>
          </Switch>
        )}
      </List>
    </Dialog>
  )
}
