import { createMemo, createSignal, createUniqueId, Show } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { Icon } from "@opencode-ai/ui/icon"
import { Progress } from "@opencode-ai/ui/progress"
import { SessionFilePanelV2, SessionFilePanelV2Empty } from "@opencode-ai/session-ui/v2/session-file-panel-v2"
import { SessionReviewV2Sidebar } from "@opencode-ai/session-ui/v2/session-review-v2"
import FileTreeV2, { type Kind } from "@/components/file-tree-v2"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useFileActions } from "@/hooks/use-file-actions"
import { displayName } from "@/pages/layout/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { SessionFileView } from "@/pages/session/file-tabs"
import { applyFileListKeyDown, SessionFileListV2 } from "@/pages/session/v2/session-file-list-v2"
import { pathKey } from "@/utils/path-key"

const emptyFiles: string[] = []

export type SessionFileBrowserState = {
  sidebarOpened: () => boolean
  sidebarWidth: () => number
  sidebarTransition: () => boolean
  resizeSidebar: (width: number) => void
  toggleSidebar: () => void
}

export function SessionFileBrowserTab(props: {
  tab: string
  placeholder: boolean
  active?: string
  kinds: ReadonlyMap<string, Kind>
  state: SessionFileBrowserState
  onSelect: (path: string) => void
  onSelectPermanent: (path: string) => void
  filterRef?: (element: HTMLInputElement) => void
}) {
  const file = useFile()
  const language = useLanguage()
  const layout = useLayout()
  const sdk = useSDK()
  const actions = useFileActions()
  const { workspaceKey } = useSessionLayout()
  const [uploading, setUploading] = createSignal(false)
  const [uploadProgress, setUploadProgress] = createSignal(0)

  async function handleUpload(files: File[]) {
    setUploading(true)
    setUploadProgress(0)
    try {
      for (const file of files) await actions.upload(file, setUploadProgress)
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  function onUploadPick(event: Event) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ""
    if (files.length === 0) return
    void handleUpload(files)
  }
  const resultsID = `session-file-browser-results-${createUniqueId()}`
  const [filter, setFilter] = createSignal("")
  const [explicitHighlight, setExplicitHighlight] = createSignal<string>()
  const sidebarOpened = () => props.placeholder || props.state.sidebarOpened()
  const query = createMemo(() => filter().trim())
  const search = createQuery(() => {
    const value = query()
    return {
      queryKey: ["session-open-file", workspaceKey(), value] as const,
      enabled: value.length > 0,
      queryFn: ({ signal }) => file.searchFiles(value, { limit: 200, signal }),
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
  const project = createMemo(() => {
    const directory = pathKey(sdk().directory)
    return layout.projects
      .list()
      .find(
        (item) =>
          pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
      )
  })
  const title = createMemo(() => displayName(project() ?? { worktree: sdk().directory }))
  const optionID = (path: string) => `${resultsID}-option-${files().indexOf(path)}`

  const onFilterKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape" && query()) {
      event.preventDefault()
      setFilter("")
      return
    }
    if (!query()) return
    applyFileListKeyDown(event, files(), highlighted(), {
      onHighlight: setExplicitHighlight,
      onSelect: props.onSelectPermanent,
    })
  }

  // Keep the sidebar outside Kobalte Tabs.Content: a morphing content value
  // unmounts the whole panel on every file-tab switch and resets sidebar scroll.
  return (
    <SessionFilePanelV2
      toolbar={false}
      sidebar={
        <SessionReviewV2Sidebar
          open={sidebarOpened()}
          transition={props.state.sidebarTransition()}
          title={<span class="truncate">{title()}</span>}
          filter={filter()}
          onFilterChange={setFilter}
          onFilterKeyDown={onFilterKeyDown}
          filterAutofocus={props.placeholder}
          filterRef={props.filterRef}
          filterControls={resultsID}
          filterActiveDescendant={highlighted() ? optionID(highlighted()!) : undefined}
          filterExpanded={query().length > 0 && files().length > 0}
          width={props.state.sidebarWidth()}
          onWidthChange={props.state.resizeSidebar}
        >
          <Show
            when={query()}
            fallback={
              <FileTreeV2
                active={props.active}
                kinds={props.kinds}
                onFileClick={(node) => props.onSelect(node.path)}
                onFileDoubleClick={(node) => props.onSelectPermanent(node.path)}
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
                  id={resultsID}
                  role="listbox"
                  optionID={optionID}
                  files={files()}
                  kinds={props.kinds}
                  active={props.active}
                  highlighted={highlighted()}
                  onFileClick={(path) => {
                    setExplicitHighlight(path)
                    props.onSelect(path)
                  }}
                  onFileDoubleClick={props.onSelectPermanent}
                />
              </Show>
            </Show>
          </Show>
        </SessionReviewV2Sidebar>
      }
    >
      <Show
        when={!props.placeholder}
        fallback={
          <SessionFilePanelV2Empty>
            <input id="file-browser-upload-input" type="file" multiple class="hidden" onChange={onUploadPick} disabled={uploading()} />
            <div
              class="flex flex-col items-center gap-3 text-center text-text-weak cursor-pointer"
              onClick={() => document.getElementById("file-browser-upload-input")?.click()}
              role="button"
              tabindex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById("file-browser-upload-input")?.click() }}
            >
              <Show
                when={!uploading()}
                fallback={
                  <Progress
                    value={uploadProgress() * 100}
                    maxValue={100}
                    showValueLabel
                    hideLabel
                    class="w-40"
                    aria-label={language.t("session.files.uploading")}
                  />
                }
              >
                <Icon name="cloud-upload" size="large" />
              </Show>
              <div class="text-14-medium text-text-strong">{language.t("command.file.open")}</div>
              <div class="text-13-regular">{language.t("session.files.selectToOpen")}</div>
            </div>
          </SessionFilePanelV2Empty>
        }
      >
        <div class="min-h-0 flex-1">
          <Show when={props.tab} keyed>
            {(tab) => <SessionFileView tab={tab} />}
          </Show>
        </div>
      </Show>
    </SessionFilePanelV2>
  )
}
