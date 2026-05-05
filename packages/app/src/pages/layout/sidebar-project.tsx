import { createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/shared/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { createSortable } from "@thisbeyond/solid-dnd"
import { useLayout, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { ProjectIcon, SessionItem, type SessionItemProps } from "./sidebar-items"
import { displayName, sortedRootSessions } from "./helpers"

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  sidebarOpened: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  hoverProject: Accessor<string | undefined>
  onProjectMouseEnter: (worktree: string, event: MouseEvent) => void
  onProjectMouseLeave: (worktree: string) => void
  onProjectFocus: (worktree: string) => void
  onHoverOpenChanged: (worktree: string, hovered: boolean) => void
  navigateToProject: (directory: string) => void
  openSidebar: () => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "mobile" | "dense">
}

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="bg-background-base rounded-xl p-1">
          <ProjectIcon project={p()} />
        </div>
      )}
    </Show>
  )
}

const ProjectTile = (props: {
  project: LocalProject
  mobile?: boolean
  sidebarHovering: Accessor<boolean>
  selected: Accessor<boolean>
  active: Accessor<boolean>
  overlay: Accessor<boolean>
  suppressHover: Accessor<boolean>
  onProjectMouseEnter: (worktree: string, event: MouseEvent) => void
  onProjectMouseLeave: (worktree: string) => void
  onProjectFocus: (worktree: string) => void
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  setMenu: (value: boolean) => void
  setOpen: (value: boolean) => void
  setSuppressHover: (value: boolean) => void
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const layout = useLayout()

  return (
    <ContextMenu
      modal={!props.sidebarHovering()}
      onOpenChange={(value) => {
        props.setMenu(value)
        props.setSuppressHover(value)
        if (value) props.setOpen(false)
      }}
    >
      <ContextMenu.Trigger
        as="button"
        type="button"
        aria-label={displayName(props.project)}
        data-action="project-switch"
        data-project={base64Encode(props.project.worktree)}
        classList={{
          "flex items-center justify-center size-10 p-1 rounded-lg overflow-hidden transition-colors cursor-default": true,
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": props.selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !props.selected() && !props.active(),
          "bg-surface-base-hover border border-border-weak-base": !props.selected() && props.active(),
        }}
        onPointerDown={(event) => {
          if (event.button === 0 && !event.ctrlKey) {
            props.setOpen(false)
            props.setSuppressHover(true)
            return
          }
          if (!props.overlay()) return
          if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return
          props.setOpen(false)
          props.setSuppressHover(true)
          event.preventDefault()
        }}
        onMouseEnter={(event: MouseEvent) => {
          if (!props.overlay()) return
          if (props.suppressHover()) return
          props.onProjectMouseEnter(props.project.worktree, event)
        }}
        onMouseLeave={() => {
          if (props.suppressHover()) props.setSuppressHover(false)
          if (!props.overlay()) return
          props.onProjectMouseLeave(props.project.worktree)
        }}
        onFocus={() => {
          if (!props.overlay()) return
          if (props.suppressHover()) return
          props.onProjectFocus(props.project.worktree)
        }}
        onClick={() => {
          props.setOpen(false)
          if (props.selected()) {
            layout.sidebar.toggle()
            return
          }
          props.navigateToProject(props.project.worktree)
        }}
        onBlur={() => props.setOpen(false)}
      >
        <ProjectIcon project={props.project} notify />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => props.showEditProjectDialog(props.project)}>
            <ContextMenu.ItemLabel>{props.language.t("common.edit")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}

const ProjectPreviewPanel = (props: {
  project: LocalProject
  mobile?: boolean
  selected: Accessor<boolean>
  workspaceEnabled: Accessor<boolean>
  workspaces: Accessor<string[]>
  projectSessions: Accessor<ReturnType<typeof sortedRootSessions>>
  workspaceSessions: (directory: string) => ReturnType<typeof sortedRootSessions>
  ctx: ProjectSidebarContext
  language: ReturnType<typeof useLanguage>
}): JSX.Element => (
  <div class="-m-3 p-2 flex flex-col w-72">
    <div class="px-4 pt-2 pb-1 flex items-center gap-2">
      <div class="text-14-medium text-text-strong truncate grow">{displayName(props.project)}</div>
    </div>
    <div class="px-4 pb-2 text-12-medium text-text-weak">{props.language.t("sidebar.project.recentSessions")}</div>
    <div class="px-2 pb-2 flex flex-col gap-2">
      <Show
        when={props.workspaceEnabled()}
        fallback={
          <For each={props.projectSessions().slice(0, 2)}>
            {(session) => (
              <SessionItem
                {...props.ctx.sessionProps}
                session={session}
                list={props.projectSessions()}
                slug={base64Encode(props.project.worktree)}
                dense
                showTooltip
                mobile={props.mobile}
              />
            )}
          </For>
        }
      >
        <For each={props.workspaces()}>
          {(directory) => {
            const sessions = createMemo(() => props.workspaceSessions(directory))
            return (
              <div class="flex flex-col gap-1">
                <For each={sessions().slice(0, 2)}>
                  {(session) => (
                    <SessionItem
                      {...props.ctx.sessionProps}
                      session={session}
                      list={sessions()}
                      slug={base64Encode(directory)}
                      dense
                      showTooltip
                      mobile={props.mobile}
                    />
                  )}
                </For>
              </div>
            )
          }}
        </For>
      </Show>
    </div>
    <div class="px-2 py-2 border-t border-border-weak-base">
      <Button
        variant="ghost"
        class="flex w-full text-left justify-start text-text-base px-2 hover:bg-transparent active:bg-transparent"
        onClick={() => {
          props.ctx.openSidebar()
          props.ctx.onHoverOpenChanged(props.project.worktree, false)
          if (props.selected()) return
          props.ctx.navigateToProject(props.project.worktree)
        }}
      >
        {props.language.t("sidebar.project.viewAllSessions")}
      </Button>
    </div>
  </div>
)

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
  sortNow: Accessor<number>
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sortable = createSortable(props.project.worktree)
  const selected = createMemo(() => props.ctx.currentProject()?.worktree === props.project.worktree)
  const workspaces = createMemo(() => props.ctx.workspaceIds(props.project).slice(0, 2))
  const workspaceEnabled = createMemo(() => props.ctx.workspacesEnabled(props.project))
  const [state, setState] = createStore({
    menu: false,
    suppressHover: false,
  })

  const isHoverProject = () => props.ctx.hoverProject() === props.project.worktree
  const preview = createMemo(() => !props.mobile && props.ctx.sidebarOpened())
  const overlay = createMemo(() => !props.mobile && !props.ctx.sidebarOpened())
  const active = createMemo(() => state.menu || (preview() ? isHoverProject() : overlay() && isHoverProject()))

  const hoverOpen = () => isHoverProject() && preview() && !selected() && !state.menu

  const projectStore = createMemo(() => globalSync.child(props.project.worktree, { bootstrap: false })[0])
  const projectSessions = createMemo(() => sortedRootSessions(projectStore(), props.sortNow()))
  const workspaceSessions = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(data, props.sortNow())
  }
  const tile = () => (
    <ProjectTile
      project={props.project}
      mobile={props.mobile}
      sidebarHovering={props.ctx.sidebarHovering}
      selected={selected}
      active={active}
      overlay={overlay}
      suppressHover={() => state.suppressHover}
      onProjectMouseEnter={props.ctx.onProjectMouseEnter}
      onProjectMouseLeave={props.ctx.onProjectMouseLeave}
      onProjectFocus={props.ctx.onProjectFocus}
      navigateToProject={props.ctx.navigateToProject}
      showEditProjectDialog={props.ctx.showEditProjectDialog}
      setMenu={(value) => setState("menu", value)}
      setOpen={(value) => props.ctx.onHoverOpenChanged(props.project.worktree, value)}
      setSuppressHover={(value) => setState("suppressHover", value)}
      language={language}
    />
  )

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <Show when={preview() && !selected()} fallback={tile()}>
        <HoverCard
          open={!state.suppressHover && hoverOpen() && !state.menu}
          openDelay={0}
          closeDelay={0}
          placement="right-start"
          gutter={6}
          trigger={tile()}
          onOpenChange={(value) => {
            if (state.menu) return
            if (value && state.suppressHover) return
            props.ctx.onHoverOpenChanged(props.project.worktree, value)
          }}
        >
          <ProjectPreviewPanel
            project={props.project}
            mobile={props.mobile}
            selected={selected}
            workspaceEnabled={workspaceEnabled}
            workspaces={workspaces}
            projectSessions={projectSessions}
            workspaceSessions={workspaceSessions}
            ctx={props.ctx}
            language={language}
          />
        </HoverCard>
      </Show>
    </div>
  )
}
