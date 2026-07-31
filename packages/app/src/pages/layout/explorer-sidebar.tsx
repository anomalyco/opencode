import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createQuery } from "@tanstack/solid-query"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useExplorer } from "@/context/explorer"
import { useServerSDK } from "@/context/server-sdk"
import { SessionRouteKey, SessionStateKey } from "@/utils/server-scope"
import { setSessionHandoff } from "@/pages/session/handoff"
import { displayName } from "./helpers"
import FileTreeV2 from "@/components/file-tree-v2"
import { SessionFileListV2, applyFileListKeyDown } from "@/pages/session/v2/session-file-list-v2"
import "./explorer-sidebar.css"

const emptyFiles: string[] = []

export function ProjectExplorerSidebar(props: { mobile?: boolean }) {
  const language = useLanguage()
  const layout = useLayout()
  const explorer = useExplorer()
  const navigate = useNavigate()
  const serverSDK = useServerSDK()

  const [filter, setFilter] = createSignal("")
  const [explicitHighlight, setExplicitHighlight] = createSignal<string>()
  const [resizing, setResizing] = createSignal(false)
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

  const openFile = (path: string) => {
    const directory = explorer.directory()
    if (!directory) return
    const slug = base64Encode(directory)
    const sessionKey = SessionStateKey.from(serverSDK().scope, SessionRouteKey.fromRoute(slug))
    setSessionHandoff(sessionKey, { files: { [path]: null } })
    navigate(`/${slug}/session`)
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
              fallback={<FileTreeV2 tree={explorer.tree} onFileClick={(node) => openFile(node.path)} />}
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
    </div>
  )
}
