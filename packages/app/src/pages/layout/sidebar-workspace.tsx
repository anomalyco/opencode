import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createSortable } from "@thisbeyond/solid-dnd"
import { createMediaQuery } from "@solid-primitives/media"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { type LocalProject } from "@/context/layout"
import { useGlobalSync, useQueryOptions } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { extraAgentByDirectory } from "./extra-agents"
import { NewSessionItem, SessionItem, SessionGroupHeader, SessionSearchBar } from "./sidebar-items"
import { sessionGroupBoundaries, sortedProjectSessions, sortedRootSessions, type SessionGroupKey, workspaceKey } from "./helpers"

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
  navList: Accessor<Session[]>
  sidebarExpanded: Accessor<boolean>
  sidebarReduced: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
  generateSessionTitle: (session: Session) => Promise<void>
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

const WorkspaceHeader = (props: {
  local: Accessor<boolean>
  busy: Accessor<boolean>
  open: Accessor<boolean>
  directory: string
  language: ReturnType<typeof useLanguage>
  branch: Accessor<string | undefined>
  workspaceValue: Accessor<string>
  workspaceEditActive: Accessor<boolean>
  InlineEditor: WorkspaceSidebarContext["InlineEditor"]
  renameWorkspace: WorkspaceSidebarContext["renameWorkspace"]
  setEditor: WorkspaceSidebarContext["setEditor"]
  projectId?: string
}): JSX.Element => (
  <div class="flex items-center gap-1 min-w-0 flex-1">
    <div class="flex items-center justify-center shrink-0 size-6">
      <Show when={props.busy()} fallback={<Icon name="branch" size="small" />}>
        <Spinner class="size-[15px]" />
      </Show>
    </div>
    <span class="text-14-medium text-text-base shrink-0">
      {props.local() ? props.language.t("workspace.type.local") : props.language.t("workspace.type.sandbox")} :
    </span>
    <Show
      when={!props.local()}
      fallback={
        <span class="text-14-medium text-text-base min-w-0 truncate">
          {props.branch() ?? getFilename(props.directory)}
        </span>
      }
    >
      <props.InlineEditor
        id={`workspace:${props.directory}`}
        value={props.workspaceValue}
        onSave={(next) => {
          const trimmed = next.trim()
          if (!trimmed) return
          props.renameWorkspace(props.directory, trimmed, props.projectId, props.branch())
          props.setEditor("value", props.workspaceValue())
        }}
        class="text-14-medium text-text-base min-w-0 truncate"
        displayClass="text-14-medium text-text-base min-w-0 truncate"
        editing={props.workspaceEditActive()}
        stopPropagation={false}
        openOnDblClick={false}
      />
    </Show>
    <div class="flex items-center justify-center shrink-0 overflow-hidden w-0 opacity-0 transition-all duration-200 group-hover/workspace:w-3.5 group-hover/workspace:opacity-100 group-focus-within/workspace:w-3.5 group-focus-within/workspace:opacity-100">
      <Icon name={props.open() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-base" />
    </div>
  </div>
)

const WorkspaceActions = (props: {
  directory: string
  local: Accessor<boolean>
  busy: Accessor<boolean>
  menuOpen: Accessor<boolean>
  pendingRename: Accessor<boolean>
  setMenuOpen: (open: boolean) => void
  setPendingRename: (value: boolean) => void
  touch: Accessor<boolean>
  language: ReturnType<typeof useLanguage>
  workspaceValue: Accessor<string>
  openEditor: WorkspaceSidebarContext["openEditor"]
  showResetWorkspaceDialog: WorkspaceSidebarContext["showResetWorkspaceDialog"]
  showDeleteWorkspaceDialog: WorkspaceSidebarContext["showDeleteWorkspaceDialog"]
  root: string
  navigateToNewSession: () => void
}): JSX.Element => (
  <div
    class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 transition-opacity"
    classList={{
      "opacity-100 pointer-events-auto": props.menuOpen(),
      "opacity-0 pointer-events-none": !props.menuOpen(),
      "group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto": true,
      "group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto": true,
    }}
  >
    <DropdownMenu
      modal
      open={props.menuOpen()}
      onOpenChange={(open) => props.setMenuOpen(open)}
    >
      <Tooltip value={props.language.t("common.moreOptions")} placement="top">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="size-6 rounded-md"
          data-action="workspace-menu"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("common.moreOptions")}
        />
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          onCloseAutoFocus={(event) => {
            if (!props.pendingRename()) return
            event.preventDefault()
            props.setPendingRename(false)
            props.openEditor(`workspace:${props.directory}`, props.workspaceValue())
          }}
        >
          <DropdownMenu.Item
            disabled={props.local()}
            onSelect={() => {
              props.setPendingRename(true)
              props.setMenuOpen(false)
            }}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.rename")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showResetWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.reset")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={props.local() || props.busy()}
            onSelect={() => props.showDeleteWorkspaceDialog(props.root, props.directory)}
          >
            <DropdownMenu.ItemLabel>{props.language.t("common.delete")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
    <Show when={!props.touch()}>
      <Tooltip value={props.language.t("command.session.new")} placement="top">
        <IconButton
          icon="new-session"
          variant="ghost"
          class="size-6 rounded-md opacity-0 pointer-events-none group-hover/workspace:opacity-100 group-hover/workspace:pointer-events-auto group-focus-within/workspace:opacity-100 group-focus-within/workspace:pointer-events-auto"
          data-action="workspace-new-session"
          data-workspace={base64Encode(props.directory)}
          aria-label={props.language.t("command.session.new")}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.navigateToNewSession()
          }}
        />
      </Tooltip>
    </Show>
  </div>
)

const GROUP_LABEL_KEYS: Record<SessionGroupKey, string> = {
  today: "sidebar.group.today",
  yesterday: "sidebar.group.yesterday",
  thisWeek: "sidebar.group.thisWeek",
  thisMonth: "sidebar.group.thisMonth",
  older: "sidebar.group.older",
}

const WorkspaceSessionList = (props: {
  slug: Accessor<string>
  root?: string
  mobile?: boolean
  ctx: WorkspaceSidebarContext
  showNew: Accessor<boolean>
  loading: Accessor<boolean>
  issue: Accessor<string | undefined>
  sessions: Accessor<Session[]>
  hasMore: Accessor<boolean>
  loadMore: () => Promise<void>
  refresh?: () => Promise<void>
  language: ReturnType<typeof useLanguage>
  sortNow: Accessor<number>
}): JSX.Element => {
  const boundaries = createMemo(() => sessionGroupBoundaries(props.sessions(), props.sortNow()))

  return (
    <nav class="flex flex-col gap-1 px-3">
      <Show when={!!props.refresh}>
        <div class="px-2 pb-1">
          <Tooltip value={props.language.t("sidebar.sessions.refresh.genericagent")} placement="top">
            <Button
              variant="ghost"
              size="large"
              icon="arrow-sync"
              class="flex h-8 w-full items-center justify-center rounded-lg border border-border bg-surface-raised-base/35 px-3 text-12-medium text-text-weak transition-colors hover:border-border-strong hover:bg-surface-raised-base-hover hover:text-text"
              disabled={props.loading()}
              onClick={(event: MouseEvent) => {
                event.preventDefault()
                void props.refresh?.()
              }}
            >
              {props.language.t("sidebar.sessions.refresh.genericagent")}
            </Button>
          </Tooltip>
        </div>
      </Show>
      <Show when={props.showNew()}>
        <NewSessionItem
          slug={props.slug()}
          mobile={props.mobile}
          reduced={props.ctx.sidebarReduced()}
          sidebarExpanded={props.ctx.sidebarExpanded}
        />
      </Show>
      <Show when={props.loading()}>
        <div
          data-component="sidebar-session-loading"
          class="relative flex h-8 items-center justify-center overflow-hidden rounded-lg px-2 text-14-regular text-text-weak"
        >
          <div data-slot="sheen" class="pointer-events-none absolute inset-0" />
          <span class="relative z-10">
            {props.language.t("common.loading")}
            {props.language.t("common.loading.ellipsis")}
          </span>
        </div>
      </Show>
      <Show when={!props.loading() && props.issue()}>
        {(value) => <div class="px-2 py-1 text-14-regular text-text-weak">{value()}</div>}
      </Show>
      <For each={props.sessions()}>
        {(session) => {
          const headerKey = () => boundaries().get(session.id)
          return (
            <div>
              <Show when={headerKey()}>
                {(key) => <SessionGroupHeader label={props.language.t(GROUP_LABEL_KEYS[key()])} />}
              </Show>
              <SessionItem
                session={session}
                list={props.sessions()}
                navList={props.ctx.navList}
                slug={props.slug()}
                root={props.root}
                mobile={props.mobile}
                reduced={props.ctx.sidebarReduced()}
                sidebarExpanded={props.ctx.sidebarExpanded}
                prefetchSession={props.ctx.prefetchSession}
                archiveSession={props.ctx.archiveSession}
              />
            </div>
          )
        }}
      </For>
      <Show when={props.hasMore()}>
        <div class="relative w-full px-2 pt-2 pb-1">
          <Button
            variant="ghost"
            classList={{
              "flex h-8 w-full items-center justify-center rounded-lg border border-dashed border-border bg-surface-raised-base/35 px-3 text-12-medium text-text-weak":
                true,
              "transition-colors hover:border-border-strong hover:bg-surface-raised-base-hover hover:text-text":
                !props.ctx.sidebarReduced(),
            }}
            size="large"
            onClick={(e: MouseEvent) => {
              props.loadMore()
              ;(e.currentTarget as HTMLButtonElement).blur()
            }}
          >
            {props.language.t("common.loadMore")}
          </Button>
        </div>
      </Show>
    </nav>
  )
}

export const SortableWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  directory: string
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const navigate = useNavigate()
  const params = useParams()
  const globalSync = useGlobalSync()
  const queryOptions = useQueryOptions()
  const language = useLanguage()
  const sortable = createSortable(props.directory)
  const [workspaceStore, setWorkspaceStore] = globalSync.child(props.directory, { bootstrap: false })
  const [menu, setMenu] = createStore({
    open: false,
    pendingRename: false,
  })
  const slug = createMemo(() => base64Encode(props.directory))
  const sessions = createMemo(() => sortedRootSessions(workspaceStore, props.sortNow()))
  const local = createMemo(() => props.directory === props.project.worktree)
  const active = createMemo(() => pathKey(props.ctx.currentDir()) === pathKey(props.directory))
  const workspaceValue = createMemo(() => {
    const branch = workspaceStore.vcs?.branch
    const name = branch ?? getFilename(props.directory)
    return props.ctx.workspaceName(props.directory, props.project.id, branch) ?? name
  })
  const open = createMemo(() => props.ctx.workspaceExpanded(props.directory, local()))
  const boot = createMemo(() => open() || active())
  const count = createMemo(() => sessions().length)
  const hasMore = createMemo(() => workspaceStore.sessionTotal > count())
  const fetching = useIsFetching(() => queryOptions.sessions(pathKey(props.directory)))
  const busy = createMemo(() => props.ctx.isBusy(props.directory))
  const wasBusy = createMemo((prev) => prev || busy(), false)
  const loading = createMemo(() => open() && workspaceStore.sessions === "loading" && count() === 0 && !wasBusy())
  const touch = createMediaQuery("(hover: none)")
  const showNew = createMemo(() => !loading() && (touch() || count() === 0 || (active() && !params.id)))
  const loadMore = async () => {
    setWorkspaceStore("limit", (limit) => (limit ?? 0) + 5)
    await globalSync.project.loadSessions(props.directory)
  }

  const workspaceEditActive = createMemo(() => props.ctx.editorOpen(`workspace:${props.directory}`))
  const header = () => (
    <WorkspaceHeader
      local={local}
      busy={busy}
      open={open}
      directory={props.directory}
      language={language}
      branch={() => workspaceStore.vcs?.branch}
      workspaceValue={workspaceValue}
      workspaceEditActive={workspaceEditActive}
      InlineEditor={props.ctx.InlineEditor}
      renameWorkspace={props.ctx.renameWorkspace}
      setEditor={props.ctx.setEditor}
      projectId={props.project.id}
    />
  )

  const openWrapper = (value: boolean) => {
    props.ctx.setWorkspaceExpanded(props.directory, value)
    if (value) return
    if (props.ctx.editorOpen(`workspace:${props.directory}`)) props.ctx.closeEditor()
  }

  createEffect(() => {
    if (!boot()) return
    globalSync.child(props.directory, { bootstrap: true })
  })

  createEffect(() => {
    if (!boot()) return
    if (!open() && !active()) return
    if (workspaceStore.sessions === "ready" || workspaceStore.sessions === "loading") return
    void globalSync.project.loadSessions(props.directory, { silent: true })
  })

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
        <div class="py-1">
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
                    class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-lg ${
                      menu.open || props.ctx.sidebarReduced() ? "pr-2" : "pr-16"
                    } ${props.ctx.sidebarReduced() ? "" : "hover:bg-surface-raised-base-hover transition-[padding] duration-200 group-hover/workspace:pr-16 group-focus-within/workspace:pr-16"}`}
                    data-action="workspace-toggle"
                    data-workspace={base64Encode(props.directory)}
                  >
                    {header()}
                  </Collapsible.Trigger>
                }
              >
                <div
                  class={`flex items-center justify-between w-full pl-2 py-1.5 rounded-lg ${
                    menu.open || props.ctx.sidebarReduced() ? "pr-2" : "pr-16"
                  } ${props.ctx.sidebarReduced() ? "" : "transition-[padding] duration-200 group-hover/workspace:pr-16 group-focus-within/workspace:pr-16"}`}
                >
                  {header()}
                </div>
              </Show>
              <WorkspaceActions
                directory={props.directory}
                local={local}
                busy={busy}
                menuOpen={() => menu.open}
                pendingRename={() => menu.pendingRename}
                setMenuOpen={(open) => setMenu("open", open)}
                setPendingRename={(value) => setMenu("pendingRename", value)}
                touch={touch}
                language={language}
                workspaceValue={workspaceValue}
                openEditor={props.ctx.openEditor}
                showResetWorkspaceDialog={props.ctx.showResetWorkspaceDialog}
                showDeleteWorkspaceDialog={props.ctx.showDeleteWorkspaceDialog}
                root={props.project.worktree}
                navigateToNewSession={() => navigate(`/${slug()}/session`)}
              />
            </div>
          </div>
        </div>

        <Collapsible.Content>
          <WorkspaceSessionList
            slug={slug}
            mobile={props.mobile}
            ctx={props.ctx}
            showNew={showNew}
            loading={loading}
            issue={() => workspaceStore.session_error}
            sessions={sessions}
            hasMore={hasMore}
            loadMore={loadMore}
            language={language}
            sortNow={props.sortNow}
          />
        </Collapsible.Content>
      </Collapsible>
    </div>
  )
}

export const LocalWorkspace = (props: {
  ctx: WorkspaceSidebarContext
  project: LocalProject
  sortNow: Accessor<number>
  mobile?: boolean
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const queryOptions = useQueryOptions()
  const language = useLanguage()
  const [searchQuery, setSearchQuery] = createSignal("")
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const stores = createMemo(() => dirs().map((directory) => globalSync.child(directory)))
  const slug = createMemo(() => base64Encode(props.project.worktree))
  const allSessions = createMemo(() => sortedProjectSessions(stores().map((item) => item[0]), props.sortNow()))
  const sessions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim()
    if (!query) return allSessions()
    return allSessions().filter((s) => s.title?.toLowerCase().includes(query))
  })
  const loading = createMemo(() => stores().some((item) => item[0].sessions === "loading") && allSessions().length === 0)
  const hasMore = createMemo(
    () => !searchQuery() && stores().reduce((sum, item) => sum + item[0].sessionTotal, 0) > allSessions().length,
  )
  const issue = createMemo(() => stores().map((item) => item[0].session_error).find(Boolean))
  const extraAgent = createMemo(() => extraAgentByDirectory(props.project.worktree))
  const refresh = async () => {
    const directories = dirs()
    for (const [store, setStore] of stores()) {
      setStore("limit", Math.max(store.limit, store.sessionTotal, store.session.length + 20))
    }
    await Promise.all(directories.map((directory) => globalSync.project.loadSessions(directory, { force: true })))
  }
  const loadMore = async () => {
    stores().forEach((item) => item[1]("limit", (limit) => (limit ?? 0) + 5))
    await Promise.all(dirs().map((directory) => globalSync.project.loadSessions(directory)))
  }

  createEffect(() => {
    for (const directory of dirs()) {
      const [store] = globalSync.child(directory, { bootstrap: false })
      if (store.sessions === "ready" || store.sessions === "loading") continue
      void globalSync.project.loadSessions(directory, { silent: true })
    }
  })

  return (
    <div
      ref={(el) => props.ctx.setScrollContainerRef(el, props.mobile)}
      class="size-full flex flex-col py-2 overflow-y-auto no-scrollbar [overflow-anchor:none]"
    >
      <Show when={allSessions().length > 3}>
        <SessionSearchBar
          value={searchQuery}
          onInput={setSearchQuery}
          placeholder={language.t("sidebar.search.placeholder")}
          reduced={props.ctx.sidebarReduced()}
        />
      </Show>
      <WorkspaceSessionList
        slug={slug}
        root={props.project.worktree}
        mobile={props.mobile}
        ctx={props.ctx}
        showNew={() => false}
        loading={loading}
        issue={issue}
        sessions={sessions}
        hasMore={hasMore}
        loadMore={loadMore}
        refresh={extraAgent()?.id === "genericagent" ? refresh : undefined}
        language={language}
        sortNow={props.sortNow}
      />
    </div>
  )
}
