import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createSortable } from "@thisbeyond/solid-dnd"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { NewSessionItem, SessionItem, SessionSkeleton } from "./sidebar-items"
import { childMapByParent, sortedRootSessions } from "./helpers"

type InlineEditorComponent = (props: {
  id: string
  value: Accessor<string>
  onSave: (next: string) => void
  class?: string
  displayClass?: string
  editing?: boolean
  stopPropagation?: boolean
  openOnDblClick?: boolean
}) => JSX.Element

export type WorkspaceSidebarContext = {
  currentDir: Accessor<string>
  sidebarExpanded: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverSession: Accessor<string | undefined>
  setHoverSession: (id: string | undefined) => void
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  workspaceName: (directory: string, projectId?: string, branch?: string) => string | undefined
  renameWorkspace: (directory: string, next: string, projectId?: string, branch?: string) => void
  editorOpen: (id: string) => boolean
  openEditor: (id: string, value: string) => void
  closeEditor: () => void
  setEditor: (key: "value", value: string) => void
  InlineEditor: InlineEditorComponent
  isBusy: (directory: string) => boolean
  workspaceExpanded: (directory: string, local: boolean) => boolean
  setWorkspaceExpanded: (directory: string, value: boolean) => void
  showResetWorkspaceDialog: (root: string, directory: string) => void
  showDeleteWorkspaceDialog: (root: string, directory: string) => void
  setScrollContainerRef: (el: HTMLDivElement | undefined, mobile?: boolean) => void
}

export const WorkspaceDragOverlay = (props: {
  sidebarProject: Accessor<LocalProject | undefined>
  activeWorkspace: Accessor<string | undefined>
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const label = createMemo(() => {
    const project = props.sidebarProject()
    if (!project) return
    const directory = props.activeWorkspace()
    if (!directory) return

    const [workspaceStore] = globalSync.child(directory, { bootstrap: false })
    const kind =
      directory === project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const name = props.workspaceLabel(directory, workspaceStore.vcs?.branch, project.id)
    return `${kind} : ${name}`
  })

  return (
    <Show when={label()}>
      {(value) => <div class="bg-background-base rounded-md px-2 py-1 text-14-medium text-text-strong">{value()}</div>}
    </Show>
  )
}

export const SortableWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  directory: string
  project: LocalProject
  mobile?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sortable = createSortable(props.directory)
  const [workspaceStore, setWorkspaceStore] = globalSync.child(props.directory, { bootstrap: false })
  const [menu, setMenu] = createStore({
    open: false,
    pendingRename: false,
  })
  const slug = createMemo(() => base64Encode(props.directory))
  const sessions = createMemo(() => sortedRootSessions(workspaceStore, Date.now()))
  const children = createMemo(() => childMapByParent(workspaceStore.session))
  const local = createMemo(() => props.directory === props.project.worktree)
  const active = createMemo(() => props.ctx.currentDir() === props.directory)
  const workspaceValue = createMemo(() => {
    const branch = workspaceStore.vcs?.branch
    const name = branch ?? getFilename(props.directory)
    return props.ctx.workspaceName(props.directory, props.project.id, branch) ?? name
  })
  const open = createMemo(() => props.ctx.workspaceExpanded(props.directory, local()))
  const boot = createMemo(() => open() || active())
  const booted = createMemo((prev) => prev || workspaceStore.status === "complete", false)
  const hasMore = createMemo(() => workspaceStore.sessionTotal > sessions().length)
  const busy = createMemo(() => props.ctx.isBusy(props.directory))
  const wasBusy = createMemo((prev) => prev || busy(), false)
  const loading = createMemo(() => open() && !booted() && sessions().length === 0 && !wasBusy())
  const loadMore = async () => {
    setWorkspaceStore("limit", (limit) => limit + 5)
    await globalSync.project.loadSessions(props.directory)
  }

  const workspaceEditActive = createMemo(() => props.ctx.editorOpen(`workspace:${props.directory}`))

  const openWrapper = (value: boolean) => {
    props.ctx.setWorkspaceExpanded(props.directory, value)
    if (value) return
    if (props.ctx.editorOpen(`workspace:${props.directory}`)) props.ctx.closeEditor()
  }

  createEffect(() => {
    if (!boot()) return
    globalSync.child(props.directory, { bootstrap: true })
  })

  const header = () => (
    <div class="flex items-center gap-1 min-w-0 flex-1">
      <div class="flex items-center justify-center shrink-0 size-6">
        <Show when={busy()} fallback={<Icon name="branch" size="small" />}>
          <Spinner class="size-[15px]" />
        </Show>
      </div>
      <span class="text-14-medium text-text-base shrink-0">
        {local() ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")} :
      </span>
      <Show
        when={!local()}
        fallback={
          <span class="text-14-medium text-text-base min-w-0 truncate">
            {workspaceStore.vcs?.branch ?? getFilename(props.directory)}
          </span>
        }
      >
        <props.ctx.InlineEditor
          id={`workspace:${props.directory}`}
          value={workspaceValue}
          onSave={(next) => {
            const trimmed = next.trim()
            if (!trimmed) return
            props.ctx.renameWorkspace(props.directory, trimmed, props.project.id, workspaceStore.vcs?.branch)
            props.ctx.setEditor("value", workspaceValue())
          }}
          class="text-14-medium text-text-base min-w-0 truncate"
          displayClass="text-14-medium text-text-base min-w-0 truncate"
          editing={workspaceEditActive()}
          stopPropagation={false}
          openOnDblClick={false}
        />
      </Show>
      <Icon
        name={open() ? "chevron-down" : "chevron-right"}
        size="small"
        class="shrink-0 text-icon-base opacity-0 transition-opacity group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100"
      />
    </div>
  )

  return (
    <div
      // @ts-ignore
      use:sortable
      classList={{
        "opacity-30": sortable.isActiveDraggable,
        "opacity-50 pointer-events-none": busy(),
      }}
    >
      <Collapsible variant="ghost" open={open()} class="shrink-0" onOpenChange={openWrapper}>
        <div class="px-2 py-1">
          <div
            class="group/workspace relative"
            data-component="workspace-item"
            data-workspace={base64Encode(props.directory)}
          >
            <div class="flex items-center gap-1">
              <Show
                when={workspaceEditActive()}
                fallback={
                  <Collapsible.Trigger
                    class="flex items-center justify-between w-full pl-2 pr-16 py-1.5 rounded-md hover:bg-surface-raised-base-hover"
                    data-action="workspace-toggle"
                    data-workspace={base64Encode(props.directory)}
                  >
                    {header()}
                  </Collapsible.Trigger>
                }
              >
                <div class="flex items-center justify-between w-full pl-2 pr-16 py-1.5 rounded-md">{header()}</div>
              </Show>
              <div
                class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
                classList={{
                  "opacity-100 pointer-events-auto": menu.open,
                  "opacity-0 pointer-events-none": !menu.open,
                  "group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto": true,
                  "group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto": true,
                }}
              >
                <DropdownMenu
                  modal={!props.ctx.sidebarHovering()}
                  open={menu.open}
                  onOpenChange={(open) => setMenu("open", open)}
                >
                  <Tooltip value={language.t("common.moreOptions")} placement="top">
                    <DropdownMenu.Trigger
                      as={IconButton}
                      icon="dot-grid"
                      variant="ghost"
                      class="size-6 rounded-md"
                      data-action="workspace-menu"
                      data-workspace={base64Encode(props.directory)}
                      aria-label={language.t("common.moreOptions")}
                    />
                  </Tooltip>
                  <DropdownMenu.Portal mount={!props.mobile ? props.ctx.nav() : undefined}>
                    <DropdownMenu.Content
                      onCloseAutoFocus={(event) => {
                        if (!menu.pendingRename) return
                        event.preventDefault()
                        setMenu("pendingRename", false)
                        props.ctx.openEditor(`workspace:${props.directory}`, workspaceValue())
                      }}
                    >
                      <DropdownMenu.Item
                        disabled={local()}
                        onSelect={() => {
                          setMenu("pendingRename", true)
                          setMenu("open", false)
                        }}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={local() || busy()}
                        onSelect={() => props.ctx.showResetWorkspaceDialog(props.project.worktree, props.directory)}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.reset")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        disabled={local() || busy()}
                        onSelect={() => props.ctx.showDeleteWorkspaceDialog(props.project.worktree, props.directory)}
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        <Collapsible.Content>
          <nav class="flex flex-col gap-1 px-2">
            <NewSessionItem
              slug={slug()}
              mobile={props.mobile}
              sidebarExpanded={props.ctx.sidebarExpanded}
              clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
              setHoverSession={props.ctx.setHoverSession}
            />
            <Show when={loading()}>
              <SessionSkeleton />
            </Show>
            <For each={sessions()}>
              {(session) => (
                <SessionItem
                  session={session}
                  slug={slug()}
                  mobile={props.mobile}
                  children={children()}
                  sidebarExpanded={props.ctx.sidebarExpanded}
                  sidebarHovering={props.ctx.sidebarHovering}
                  nav={props.ctx.nav}
                  hoverSession={props.ctx.hoverSession}
                  setHoverSession={props.ctx.setHoverSession}
                  clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                  prefetchSession={props.ctx.prefetchSession}
                  archiveSession={props.ctx.archiveSession}
                />
              )}
            </For>
            <Show when={hasMore()}>
              <div class="relative w-full py-1">
                <Button
                  variant="ghost"
                  class="flex w-full text-left justify-start text-14-regular text-text-weak pl-9 pr-10"
                  size="large"
                  onClick={(e: MouseEvent) => {
                    loadMore()
                    ;(e.currentTarget as HTMLButtonElement).blur()
                  }}
                >
                  {language.t("common.loadMore")}
                </Button>
              </div>
            </Show>
          </nav>
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

export const LocalWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  project: LocalProject
  mobile?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const workspace = createMemo(() => {
    const [store, setStore] = globalSync.child(props.project.worktree)
    return { store, setStore }
  })
  const slug = createMemo(() => base64Encode(props.project.worktree))
  const sessions = createMemo(() => sortedRootSessions(workspace().store, Date.now()))
  const children = createMemo(() => childMapByParent(workspace().store.session))
  const booted = createMemo((prev) => prev || workspace().store.status === "complete", false)
  const loading = createMemo(() => !booted() && sessions().length === 0)
  const hasMore = createMemo(() => workspace().store.sessionTotal > sessions().length)
  const loadMore = async () => {
    workspace().setStore("limit", (limit) => limit + 5)
    await globalSync.project.loadSessions(props.project.worktree)
  }

  return (
    <div
      ref={(el) => props.ctx.setScrollContainerRef(el, props.mobile)}
      class="size-full flex flex-col py-2 overflow-y-auto no-scrollbar [overflow-anchor:none]"
    >
      <nav class="flex flex-col gap-1 px-2">
        <Show when={loading()}>
          <SessionSkeleton />
        </Show>
        <For each={sessions()}>
          {(session) => (
            <SessionItem
              session={session}
              slug={slug()}
              mobile={props.mobile}
              children={children()}
              sidebarExpanded={props.ctx.sidebarExpanded}
              sidebarHovering={props.ctx.sidebarHovering}
              nav={props.ctx.nav}
              hoverSession={props.ctx.hoverSession}
              setHoverSession={props.ctx.setHoverSession}
              clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
              prefetchSession={props.ctx.prefetchSession}
              archiveSession={props.ctx.archiveSession}
            />
          )}
        </For>
        <Show when={hasMore()}>
          <div class="relative w-full py-1">
            <Button
              variant="ghost"
              class="flex w-full text-left justify-start text-14-regular text-text-weak pl-9 pr-10"
              size="large"
              onClick={(e: MouseEvent) => {
                loadMore()
                ;(e.currentTarget as HTMLButtonElement).blur()
              }}
            >
              {language.t("common.loadMore")}
            </Button>
          </div>
        </Show>
      </nav>
    </div>
  )
}
