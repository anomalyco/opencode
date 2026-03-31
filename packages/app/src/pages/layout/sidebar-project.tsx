import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/util/encode"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { createSortable } from "@thisbeyond/solid-dnd"
import { useLayout, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { SessionItem, type SessionItemProps } from "./sidebar-items"
import { childMapByParent, displayName, sortedRootSessions } from "./helpers"

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  currentProject: Accessor<LocalProject | undefined>
  sidebarOpened: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  nav: Accessor<HTMLElement | undefined>
  hoverProject: Accessor<string | undefined>
  onProjectMouseEnter: (worktree: string, event: MouseEvent) => void
  onProjectMouseLeave: (worktree: string) => void
  onProjectFocus: (worktree: string) => void
  onHoverOpenChanged: (worktree: string, hoverOpen: boolean) => void
  navigateToProject: (directory: string) => void
  openSidebar: () => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sessionProps: Omit<SessionItemProps, "session" | "list" | "slug" | "children" | "mobile" | "dense" | "popover">
  setHoverSession: (id: string | undefined) => void
}

// Store for tracking expanded state of projects and workspaces
const [expandedState, setExpandedState] = createStore<{
  projects: Record<string, boolean>
  workspaces: Record<string, boolean>
}>({
  projects: {},
  workspaces: {},
})

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="bg-background-base rounded-md px-3 py-2 flex items-center gap-2 shadow-lg border border-border-weaker-base">
          <Icon name="folder" size="small" class="text-icon-base" />
          <span class="text-14-medium text-text-strong truncate">{displayName(p())}</span>
        </div>
      )}
    </Show>
  )
}

const ProjectRow = (props: {
  project: LocalProject
  ctx: ProjectSidebarContext
  setMenu: (value: boolean) => void
  mobile?: boolean
}): JSX.Element => {
  const language = useLanguage()
  const notification = useNotification()
  const globalSync = useGlobalSync()
  
  const worktree = () => props.project.worktree
  const isExpanded = () => expandedState.projects[worktree()] ?? false
  const isSelected = () => props.ctx.currentProject()?.worktree === worktree()
  
  const dirs = createMemo(() => props.ctx.workspaceIds(props.project))
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  
  const clear = () =>
    dirs()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  
  const workspacesEnabled = () => props.ctx.workspacesEnabled(props.project)
  const workspaces = () => props.ctx.workspaceIds(props.project)
  
  const projectStore = createMemo(() => globalSync.child(worktree(), { bootstrap: false })[0])
  const projectSessions = createMemo(() => sortedRootSessions(projectStore(), Date.now()))
  const projectChildren = createMemo(() => childMapByParent(projectStore().session))
  
  const workspaceSessions = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(data, Date.now())
  }
  
  const workspaceChildren = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return childMapByParent(data.session)
  }
  
  const workspaceLabel = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return props.ctx.workspaceLabel(directory, data.vcs?.branch, props.project.id)
  }
  
  const toggleExpand = () => {
    setExpandedState("projects", worktree(), !isExpanded())
  }
  
  return (
    <ContextMenu
      onOpenChange={(value) => {
        props.setMenu(value)
      }}
    >
      <div class="flex flex-col">
        {/* Project Header Row */}
        <div class="group flex items-center gap-2 px-4 py-2 w-full hover:bg-surface-base-hover transition-colors"
          classList={{ "bg-surface-base-active": isSelected() }}
        >
          <button
            type="button"
            data-project={base64Encode(props.project.worktree)}
            class="flex items-center gap-2 flex-1 text-left min-w-0"
            onClick={toggleExpand}
          >
            <Icon 
              name={isExpanded() ? "chevron-down" : "chevron-right"} 
              size="small" 
              class="text-icon-weak shrink-0" 
            />
            <Icon 
              name="folder" 
              size="small" 
              classList={{
                "text-icon-base shrink-0": true,
                "text-icon-interactive-base": isSelected(),
              }} 
            />
            <span classList={{
              "flex-1 truncate text-14-medium": true,
              "text-text-strong": !isSelected(),
              "text-text-interactive-base": isSelected(),
            }}>
              {displayName(props.project)}
            </span>
          </button>
          
          <Show when={unseenCount() > 0}>
            <div class="size-1.5 rounded-full bg-text-interactive-base shrink-0" />
          </Show>
          
          {/* Menu trigger button for tests and accessibility */}
          <ContextMenu.Trigger 
            class="shrink-0 p-1 rounded hover:bg-surface-base-hover opacity-0 group-hover:opacity-100 focus:opacity-100"
            data-action="project-menu"
            data-project={base64Encode(props.project.worktree)}
          >
            <Icon name="more" size="small" class="text-icon-weak" />
          </ContextMenu.Trigger>
        </div>
        
        <ContextMenu.Portal>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => props.ctx.showEditProjectDialog(props.project)}>
              <ContextMenu.ItemLabel>{language.t("common.edit")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="project-workspaces-toggle"
              data-project={base64Encode(props.project.worktree)}
              disabled={props.project.vcs !== "git" && !workspacesEnabled()}
              onSelect={() => props.ctx.toggleProjectWorkspaces(props.project)}
            >
              <ContextMenu.ItemLabel>
                {workspacesEnabled()
                  ? language.t("sidebar.workspaces.disable")
                  : language.t("sidebar.workspaces.enable")}
              </ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Item
              data-action="project-clear-notifications"
              data-project={base64Encode(props.project.worktree)}
              disabled={unseenCount() === 0}
              onSelect={clear}
            >
              <ContextMenu.ItemLabel>{language.t("sidebar.project.clearNotifications")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              data-action="project-close-menu"
              data-project={base64Encode(props.project.worktree)}
              onSelect={() => props.ctx.closeProject(props.project.worktree)}
            >
              <ContextMenu.ItemLabel>{language.t("common.close")}</ContextMenu.ItemLabel>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
        
        {/* Expanded Content: Workspaces or Sessions */}
        <Show when={isExpanded()}>
          <div class="pl-4 flex flex-col">
            <Show
              when={workspacesEnabled() && workspaces().length > 1}
              fallback={
                /* Show sessions directly if no workspaces or single workspace */
                <For each={projectSessions()}>
                  {(session) => (
                    <SessionItem
                      {...props.ctx.sessionProps}
                      session={session}
                      list={projectSessions()}
                      slug={base64Encode(worktree())}
                      dense
                      mobile={props.mobile}
                      popover={false}
                      children={projectChildren()}
                    />
                  )}
                </For>
              }
            >
              {/* Show workspaces as sub-folders */}
              <For each={workspaces()}>
                {(workspaceDir) => {
                  const workspaceKey = `${worktree()}-${workspaceDir}`
                  const isWorkspaceExpanded = () => expandedState.workspaces[workspaceKey] ?? false
                  const sessions = createMemo(() => workspaceSessions(workspaceDir))
                  const children = createMemo(() => workspaceChildren(workspaceDir))
                  
                  const toggleWorkspace = () => {
                    setExpandedState("workspaces", workspaceKey, !isWorkspaceExpanded())
                  }
                  
                  return (
                    <div class="flex flex-col">
                      {/* Workspace Header */}
                      <button
                        type="button"
                        onClick={toggleWorkspace}
                        class="flex items-center gap-2 px-4 py-1.5 hover:bg-surface-base-hover text-left"
                      >
                        <Icon 
                          name={isWorkspaceExpanded() ? "chevron-down" : "chevron-right"} 
                          size="small" 
                          class="text-icon-weak shrink-0" 
                        />
                        <Icon name="branch" size="small" class="text-icon-weak shrink-0" />
                        <span class="flex-1 truncate text-14-regular text-text-base">
                          {workspaceLabel(workspaceDir)}
                        </span>
                      </button>
                      
                      {/* Workspace Sessions */}
                      <Show when={isWorkspaceExpanded()}>
                        <div class="pl-8 flex flex-col">
                          <For each={sessions()}>
                            {(session) => (
                              <SessionItem
                                {...props.ctx.sessionProps}
                                session={session}
                                list={sessions()}
                                slug={base64Encode(workspaceDir)}
                                dense
                                mobile={props.mobile}
                                popover={false}
                                children={children()}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </ContextMenu>
  )
}

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
  sortNow: Accessor<number>
}): JSX.Element => {
  const sortable = createSortable(props.project.worktree)
  const [state, setState] = createStore({
    menu: false,
  })

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <ProjectRow
        project={props.project}
        ctx={props.ctx}
        setMenu={(value) => setState("menu", value)}
        mobile={props.mobile}
      />
    </div>
  )
}
