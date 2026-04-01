import { createEffect, createMemo, For, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createSortable } from "@thisbeyond/solid-dnd"
import { useLayout, type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { ProjectIcon, SessionItem, type SessionItemProps } from "./sidebar-items"
import { childMapByParent, displayName, sortedRootSessions } from "./helpers"
import { projectSelected, projectTileActive } from "./sidebar-project-helpers"

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  sidebarOpened: Accessor<boolean>
  sidebarHovering: Accessor<boolean>
  hoverProject: Accessor<string | undefined>
  nav: Accessor<HTMLElement | undefined>
  onProjectMouseEnter: (worktree: string, event: MouseEvent) => void
  onProjectMouseLeave: (worktree: string) => void
  onProjectFocus: (worktree: string) => void
  navigateToProject: (directory: string) => void
  openSidebar: () => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
  workspaceLabel: (directory: string, branch?: string, projectId?: string) => string
  sessionProps: Omit<SessionItemProps, "session" | "slug" | "children" | "mobile" | "dense" | "popover">
  setHoverSession: (id: string | undefined) => void
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
  nav: Accessor<HTMLElement | undefined>
  sidebarHovering: Accessor<boolean>
  selected: Accessor<boolean>
  active: Accessor<boolean>
  overlay: Accessor<boolean>
  suppressHover: Accessor<boolean>
  dirs: Accessor<string[]>
  onProjectMouseEnter: (worktree: string, event: MouseEvent) => void
  onProjectMouseLeave: (worktree: string) => void
  onProjectFocus: (worktree: string) => void
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  closeProject: (directory: string) => void
  setMenu: (value: boolean) => void
  setOpen: (value: boolean) => void
  setSuppressHover: (value: boolean) => void
  language: ReturnType<typeof useLanguage>
}): JSX.Element => {
  const notification = useNotification()
  const layout = useLayout()
  const unseenCount = createMemo(() =>
    props.dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )

  const clear = () =>
    props
      .dirs()
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))

  return (
    <ContextMenu
      modal={!props.sidebarHovering()}
      onOpenChange={(value) => {
        props.setMenu(value)
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
          if (props.selected()) {
            props.setSuppressHover(true)
            layout.sidebar.toggle()
            return
          }
          props.setSuppressHover(false)
          props.navigateToProject(props.project.worktree)
        }}
        onBlur={() => props.setOpen(false)}
      >
        <ProjectIcon project={props.project} notify />
      </ContextMenu.Trigger>
      <ContextMenu.Portal mount={!props.mobile ? props.nav() : undefined}>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => props.showEditProjectDialog(props.project)}>
            <ContextMenu.ItemLabel>{props.language.t("common.edit")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item
            data-action="project-workspaces-toggle"
            data-project={base64Encode(props.project.worktree)}
            disabled={props.project.vcs !== "git" && !props.workspacesEnabled(props.project)}
            onSelect={() => props.toggleProjectWorkspaces(props.project)}
          >
            <ContextMenu.ItemLabel>
              {props.workspacesEnabled(props.project)
                ? props.language.t("sidebar.workspaces.disable")
                : props.language.t("sidebar.workspaces.enable")}
            </ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item
            data-action="project-clear-notifications"
            data-project={base64Encode(props.project.worktree)}
            disabled={unseenCount() === 0}
            onSelect={clear}
          >
            <ContextMenu.ItemLabel>{props.language.t("sidebar.project.clearNotifications")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            data-action="project-close-menu"
            data-project={base64Encode(props.project.worktree)}
            onSelect={() => props.closeProject(props.project.worktree)}
          >
            <ContextMenu.ItemLabel>{props.language.t("common.close")}</ContextMenu.ItemLabel>
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
  label: (directory: string) => string
  projectSessions: Accessor<ReturnType<typeof sortedRootSessions>>
  projectChildren: Accessor<Map<string, string[]>>
  workspaceSessions: (directory: string) => ReturnType<typeof sortedRootSessions>
  workspaceChildren: (directory: string) => Map<string, string[]>
  setOpen: (value: boolean) => void
  ctx: ProjectSidebarContext
  language: ReturnType<typeof useLanguage>
}): JSX.Element => (
  <div class="-m-3 p-2 flex flex-col w-72">
    <div class="px-4 pt-2 pb-1 flex items-center gap-2">
      <div class="text-14-medium text-text-strong truncate grow">{displayName(props.project)}</div>
      <Tooltip value={props.language.t("common.close")} placement="top" gutter={6}>
        <IconButton
          icon="circle-x"
          variant="ghost"
          class="shrink-0"
          data-action="project-close-hover"
          data-project={base64Encode(props.project.worktree)}
          aria-label={props.language.t("common.close")}
          onClick={(event) => {
            event.stopPropagation()
            props.setOpen(false)
            props.ctx.closeProject(props.project.worktree)
          }}
        />
      </Tooltip>
    </div>
    <div class="px-4 pb-2 text-12-medium text-text-weak">{props.language.t("sidebar.project.recentSessions")}</div>
    <div class="px-2 pb-2 flex flex-col gap-2">
      <Show
        when={props.workspaceEnabled()}
        fallback={
          <For each={props.projectSessions()}>
            {(session) => (
              <SessionItem
                {...props.ctx.sessionProps}
                session={session}
                slug={base64Encode(props.project.worktree)}
                dense
                mobile={props.mobile}
                popover={false}
                children={props.projectChildren()}
              />
            )}
          </For>
        }
      >
        <For each={props.workspaces()}>
          {(directory) => {
            const sessions = createMemo(() => props.workspaceSessions(directory))
            const children = createMemo(() => props.workspaceChildren(directory))
            return (
              <div class="flex flex-col gap-1">
                <div class="px-2 py-0.5 flex items-center gap-1 min-w-0">
                  <div class="shrink-0 size-6 flex items-center justify-center">
                    <Icon name="branch" size="small" class="text-icon-base" />
                  </div>
                  <span class="truncate text-14-medium text-text-base">{props.label(directory)}</span>
                </div>
                <For each={sessions()}>
                  {(session) => (
                    <SessionItem
                      {...props.ctx.sessionProps}
                      session={session}
                      slug={base64Encode(directory)}
                      dense
                      mobile={props.mobile}
                      popover={false}
                      children={children()}
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
          props.setOpen(false)
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
  const selected = createMemo(() =>
    projectSelected(props.ctx.currentDir(), props.project.worktree, props.project.sandboxes),
  )
  const workspaces = createMemo(() => props.ctx.workspaceIds(props.project).slice(0, 2))
  const workspaceEnabled = createMemo(() => props.ctx.workspacesEnabled(props.project))
  const dirs = createMemo(() => props.ctx.workspaceIds(props.project))
  const [state, setState] = createStore({
    open: false,
    menu: false,
    suppressHover: false,
  })

  const preview = createMemo(() => !props.mobile && props.ctx.sidebarOpened())
  const overlay = createMemo(() => !props.mobile && !props.ctx.sidebarOpened())
  const active = createMemo(() =>
    projectTileActive({
      menu: state.menu,
      preview: preview(),
      open: state.open,
      overlay: overlay(),
      hoverProject: props.ctx.hoverProject(),
      worktree: props.project.worktree,
    }),
  )

  createEffect(() => {
    if (preview()) return
    if (!state.open) return
    setState("open", false)
  })

  createEffect(() => {
    if (!selected()) return
    if (!state.open) return
    setState("open", false)
  })

  const label = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    const kind =
      directory === props.project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const name = props.ctx.workspaceLabel(directory, data.vcs?.branch, props.project.id)
    return `${kind} : ${name}`
  }

  const projectStore = createMemo(() => globalSync.child(props.project.worktree, { bootstrap: false })[0])
  const projectSessions = createMemo(() => sortedRootSessions(projectStore(), props.sortNow()).slice(0, 2))
  const projectChildren = createMemo(() => childMapByParent(projectStore().session))
  const workspaceSessions = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(data, props.sortNow()).slice(0, 2)
  }
  const workspaceChildren = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return childMapByParent(data.session)
  }
  const tile = () => (
    <ProjectTile
      project={props.project}
      mobile={props.mobile}
      nav={props.ctx.nav}
      sidebarHovering={props.ctx.sidebarHovering}
      selected={selected}
      active={active}
      overlay={overlay}
      suppressHover={() => state.suppressHover}
      dirs={dirs}
      onProjectMouseEnter={props.ctx.onProjectMouseEnter}
      onProjectMouseLeave={props.ctx.onProjectMouseLeave}
      onProjectFocus={props.ctx.onProjectFocus}
      navigateToProject={props.ctx.navigateToProject}
      showEditProjectDialog={props.ctx.showEditProjectDialog}
      toggleProjectWorkspaces={props.ctx.toggleProjectWorkspaces}
      workspacesEnabled={props.ctx.workspacesEnabled}
      closeProject={props.ctx.closeProject}
      setMenu={(value) => setState("menu", value)}
      setOpen={(value) => setState("open", value)}
      setSuppressHover={(value) => setState("suppressHover", value)}
      language={language}
    />
  )

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <Show when={preview() && !selected()} fallback={tile()}>
        <HoverCard
          open={!state.suppressHover && state.open && !state.menu}
          openDelay={0}
          closeDelay={0}
          placement="right-start"
          gutter={6}
          trigger={tile()}
          onOpenChange={(value) => {
            if (state.menu) return
            if (value && state.suppressHover) return
            setState("open", value)
            if (value) props.ctx.setHoverSession(undefined)
          }}
        >
          <ProjectPreviewPanel
            project={props.project}
            mobile={props.mobile}
            selected={selected}
            workspaceEnabled={workspaceEnabled}
            workspaces={workspaces}
            label={label}
            projectSessions={projectSessions}
            projectChildren={projectChildren}
            workspaceSessions={workspaceSessions}
            workspaceChildren={workspaceChildren}
            setOpen={(value) => setState("open", value)}
            ctx={props.ctx}
            language={language}
          />
        </HoverCard>
      </Show>
    </div>
  )
}
