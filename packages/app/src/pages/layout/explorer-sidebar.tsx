import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useParams } from "@solidjs/router"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogV2, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { createQuery } from "@tanstack/solid-query"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useExplorer } from "@/context/explorer"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useCode } from "@/context/code"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"
import { displayName } from "./helpers"
import FileTreeV2 from "@/components/file-tree-v2"
import { encodeFilePath } from "@/context/file/path"
import { SessionFileListV2, applyFileListKeyDown } from "@/pages/session/v2/session-file-list-v2"
import type { FileNode } from "@opencode-ai/sdk/v2"
import { showToast } from "@/utils/toast"
import "./explorer-sidebar.css"

const emptyFiles: string[] = []

const absolutePath = (directory: string, path: string) => {
  const dir = directory.replace(/[/\\]+$/, "")
  const rel = path.replace(/^[/\\]+/, "")
  return `${dir}/${rel}`
}

const parentDir = (path: string) => {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (index === -1) return ""
  return path.slice(0, index)
}

export function ProjectExplorerSidebar(props: { mobile?: boolean }) {
  const language = useLanguage()
  const layout = useLayout()
  const explorer = useExplorer()
  const params = useParams()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  const dialog = useDialog()
  const code = useCode()

  const [filter, setFilter] = createSignal("")
  const [explicitHighlight, setExplicitHighlight] = createSignal<string>()
  const [resizing, setResizing] = createSignal(false)
  const [menu, setMenu] = createSignal<{ x: number; y: number; node: FileNode } | undefined>()
  const hasDirectory = createMemo(() => explorer.directory() !== undefined)
  const opened = createMemo(() => (layout.explorer.opened() || props.mobile) && hasDirectory())
  const query = createMemo(() => filter().trim())

  createEffect(() => {
    if (!resizing()) return
    const stop = () => setResizing(false)
    makeEventListener(document, "pointerup", stop)
    makeEventListener(document, "pointercancel", stop)
  })

  const project = createMemo(() => {
    const directory = explorer.directory()
    if (!directory) return
    return layout.projects
      .list()
      .find((item) => item.worktree === directory || item.sandboxes?.includes(directory))
  })

  const title = createMemo(() => displayName(project() ?? { worktree: explorer.directory() ?? "" }))

  const search = createQuery(() => {
    const value = query()
    const directory = explorer.directory()
    return {
      queryKey: ["explorer-files", serverSDK().url, value] as const,
      enabled: value.length > 0 && !!directory,
      queryFn: ({ signal }) =>
        serverSDK()
          .api.file.find({
            location: { directory },
            query: value,
            type: "file",
            limit: 200,
          })
          .then((x) => x.data.map((entry) => entry.path)),
    }
  })

  const files = createMemo(() => {
    if (!query() || search.isPending) return emptyFiles
    return [...new Set(search.data ?? emptyFiles)]
  })

  const highlighted = createMemo(() => {
    const values = files()
    if (values.length === 0) return undefined
    const explicit = explicitHighlight()
    if (explicit && values.includes(explicit)) return explicit
    return values[0]
  })

  const loading = createMemo(() => query().length > 0 && search.isPending)

  const currentSessionKey = createMemo(() => {
    const sessionID = params.id
    const directory = explorer.directory()
    if (!sessionID || !directory) return
    return SessionStateKey.from(
      serverSDK().scope,
      SessionRouteKey.fromRoute(base64Encode(directory), sessionID),
    )
  })

  const openFile = (path: string) => {
    const directory = explorer.directory()
    if (!directory) return
    code.open(path)
    layout.codePanel.open()
    const sessionKey = currentSessionKey()
    if (sessionKey) {
      const value = `file://${encodeFilePath(path)}`
      const tabs = layout.tabs(sessionKey)
      tabs().open(value)
      tabs().setActive(value)
      layout.view(sessionKey).reviewPanel.open()
      return
    }
  }

  const refresh = (path?: string) => {
    void explorer.tree.refresh(path ?? "")
  }

  const renameFile = async (node: FileNode, nextName: string) => {
    const directory = explorer.directory()
    if (!directory) return
    const name = nextName.trim()
    if (!name || name === node.name) return
    if (!platform.renamePath) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: "Rename is not supported on this platform",
      })
      return
    }
    const source = absolutePath(directory, node.path)
    const dir = parentDir(node.path)
    const target = absolutePath(directory, dir ? `${dir}/${name}` : name)
    try {
      await platform.renamePath(source, target)
      refresh(dir)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const removeFile = async (node: FileNode) => {
    const directory = explorer.directory()
    if (!directory) return
    if (!platform.removePath) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: "Delete is not supported on this platform",
      })
      return
    }
    try {
      await platform.removePath(absolutePath(directory, node.path))
      refresh(parentDir(node.path))
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const openRenameDialog = (node: FileNode) => {
    dialog.show(() => (
      <RenameDialog node={node} onConfirm={(next) => void renameFile(node, next)} onClose={() => dialog.close()} />
    ))
  }

  const openDeleteDialog = (node: FileNode) => {
    dialog.show(() => (
      <DeleteDialog node={node} onConfirm={() => void removeFile(node)} onClose={() => dialog.close()} />
    ))
  }

  const handleContextMenu = (node: FileNode, event: MouseEvent) => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }

  const handleKeyDown = (node: FileNode, event: KeyboardEvent) => {
    if (event.key !== "F2") return
    event.preventDefault()
    openRenameDialog(node)
  }

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")
      return
    }
    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: openFile,
    })
  }

  const menuValue = () => menu()
  const closeMenu = () => setMenu(undefined)

  return (
    <div data-component="project-explorer" class="flex h-full min-w-0">
      <aside
        data-slot="project-explorer-sidebar"
        class="my-2 ml-2 h-[calc(100%-1rem)] shrink-0 overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
        classList={{ hidden: !opened() }}
        style={{ width: opened() ? `${layout.explorer.width()}px` : "0px" }}
      >
        <div class="flex h-full flex-col overflow-hidden">
          <div data-slot="project-explorer-header" class="flex shrink-0 items-center justify-between gap-2 px-2 pt-3 pb-1">
            <div
              data-slot="project-explorer-title"
              class="min-w-0 truncate pl-1 text-[13px] font-[500] text-v2-text-text-base"
            >
              {title()}
            </div>
            <Show when={!props.mobile}>
              <TooltipV2 value={language.t("common.close")}>
                <IconButtonV2
                  variant="ghost-muted"
                  size="small"
                  class="hover-reveal"
                  icon={<Icon name="xmark-small" />}
                  aria-label={language.t("common.close")}
                  onClick={() => layout.explorer.close()}
                />
              </TooltipV2>
            </Show>
          </div>
          <div data-slot="project-explorer-filter" class="shrink-0 px-2 pb-2">
            <TextInputV2
              type="search"
              value={filter()}
              onInput={(event) => setFilter(event.currentTarget.value)}
              onKeyDown={onFilterKeyDown}
              showClearButton={filter().length > 0}
              clearLabel={language.t("ui.list.clearFilter")}
              onClearClick={() => setFilter("")}
              placeholder={language.t("ui.sessionReviewV2.filterFiles")}
              aria-label={language.t("ui.sessionReviewV2.filterFiles")}
              leadingIcon={<Icon name="magnifying-glass" />}
            />
          </div>
          <ScrollView
            data-slot="project-explorer-tree"
            class="min-h-0 flex-1 group/file-tree-v2"
            thumbVisibility="scroll"
          >
            <Show
              when={query()}
              fallback={
                <FileTreeV2
                  tree={explorer.tree}
                  onFileClick={(node) => openFile(node.path)}
                  onFileContextMenu={handleContextMenu}
                  onFileKeyDown={handleKeyDown}
                />
              }
            >
              <Show
                when={!loading()}
                fallback={
                  <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                    {language.t("common.loading")}
                    {language.t("common.loading.ellipsis")}
                  </div>
                }
              >
                <Show
                  when={files().length > 0}
                  fallback={
                    <div role="status" class="px-2 py-2 text-12-regular text-text-weak">
                      {language.t("palette.empty")}
                    </div>
                  }
                >
                  <SessionFileListV2
                    files={files()}
                    highlighted={highlighted()}
                    onFileClick={(path) => {
                      setExplicitHighlight(path)
                      openFile(path)
                    }}
                    onFileDoubleClick={openFile}
                  />
                </Show>
              </Show>
            </Show>
          </ScrollView>
        </div>
      </aside>
      <Show when={opened() && !props.mobile}>
        <div class="my-2 flex shrink-0" onPointerDown={() => setResizing(true)}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.explorer.width()}
            min={240}
            max={640}
            onResize={(width) => {
              layout.explorer.resize(width)
            }}
          />
        </div>
      </Show>

      <Show when={menuValue()}>
        {(value) => (
          <MenuV2 open onOpenChange={(open) => !open && closeMenu()}>
            <MenuV2.Portal>
              <MenuV2.Content
                class="fixed"
                style={{ left: `${value().x}px`, top: `${value().y}px` }}
              >
                <MenuV2.Item
                  onSelect={() => {
                    const node = value().node
                    closeMenu()
                    openRenameDialog(node)
                  }}
                >
                  {language.t("common.rename")}
                </MenuV2.Item>
                <MenuV2.Item
                  onSelect={() => {
                    const node = value().node
                    closeMenu()
                    openDeleteDialog(node)
                  }}
                >
                  {language.t("common.delete")}
                </MenuV2.Item>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        )}
      </Show>
    </div>
  )
}

function RenameDialog(props: {
  node: FileNode
  onConfirm: (next: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [value, setValue] = createSignal(props.node.name)
  let input: HTMLInputElement | undefined

  createEffect(() => {
    if (!input) return
    input.focus()
    const dot = value().lastIndexOf(".")
    input.setSelectionRange(0, dot > 0 ? dot : value().length)
  })

  const submit = () => {
    const next = value()
    if (!next.trim() || next === props.node.name) {
      props.onClose()
      return
    }
    props.onConfirm(next)
    props.onClose()
  }

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("explorer.rename.title")} description={props.node.name} />
      </DialogHeader>
      <DialogBody>
        <TextInputV2
          ref={input}
          type="text"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              props.onClose()
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={props.onClose}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="contrast" onClick={submit}>
          {language.t("explorer.rename.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

function DeleteDialog(props: {
  node: FileNode
  onConfirm: () => void
  onClose: () => void
}) {
  const language = useLanguage()

  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup title={language.t("explorer.delete.title")} description={props.node.name} />
      </DialogHeader>
      <DialogBody>
        <span class="text-[13px] font-[440] leading-5 text-v2-text-text-muted">
          {language.t("explorer.delete.confirm", { name: props.node.name })}
        </span>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={props.onClose}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 variant="danger" onClick={props.onConfirm}>
          {language.t("explorer.delete.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}
