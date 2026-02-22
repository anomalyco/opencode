import { createEffect, createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js"
import { base64Encode } from "@opencode-ai/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createSortable } from "@thisbeyond/solid-dnd"
import { type LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
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

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const sortable = createSortable(props.project.worktree)
  const selected = createMemo(() =>
    projectSelected(props.ctx.currentDir(), props.project.worktree, props.project.sandboxes),
  )
  const workspaces = createMemo(() => props.ctx.workspaceIds(props.project).slice(0, 2))
  const workspaceEnabled = createMemo(() => props.ctx.workspacesEnabled(props.project))
  const [open, setOpen] = createSignal(false)
  const [menu, setMenu] = createSignal(false)

  const preview = createMemo(() => !props.mobile && props.ctx.sidebarOpened())
  const overlay = createMemo(() => !props.mobile && !props.ctx.sidebarOpened())
  const active = createMemo(() =>
    projectTileActive({
      menu: menu(),
      preview: preview(),
      open: open(),
      overlay: overlay(),
      hoverProject: props.ctx.hoverProject(),
      worktree: props.project.worktree,
    }),
  )

  createEffect(() => {
    if (preview()) return
    if (!open()) return
    setOpen(false)
  })

  const label = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    const kind =
      directory === props.project.worktree ? language.t("workspace.type.local") : language.t("workspace.type.sandbox")
    const name = props.ctx.workspaceLabel(directory, data.vcs?.branch, props.project.id)
    return `${kind} : ${name}`
  }

  const projectStore = createMemo(() => globalSync.child(props.project.worktree, { bootstrap: false })[0])
  const projectSessions = createMemo(() => sortedRootSessions(projectStore(), Date.now()).slice(0, 2))
  const projectChildren = createMemo(() => childMapByParent(projectStore().session))
  const workspaceSessions = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return sortedRootSessions(data, Date.now()).slice(0, 2)
  }
  const workspaceChildren = (directory: string) => {
    const [data] = globalSync.child(directory, { bootstrap: false })
    return childMapByParent(data.session)
  }

  const Trigger = () => (
    <ContextMenu
      modal={!props.ctx.sidebarHovering()}
      onOpenChange={(value) => {
        setMenu(value)
        if (value) setOpen(false)
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
          "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover": selected(),
          "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
            !selected() && !active(),
          "bg-surface-base-hover border border-border-weak-base": !selected() && active(),
        }}
        onMouseEnter={(event: MouseEvent) => {
          if (!overlay()) return
          props.ctx.onProjectMouseEnter(props.project.worktree, event)
        }}
        onMouseLeave={() => {
          if (!overlay()) return
          props.ctx.onProjectMouseLeave(props.project.worktree)
        }}
        onFocus={() => {
          if (!overlay()) return
          props.ctx.onProjectFocus(props.project.worktree)
        }}
        onClick={() => props.ctx.navigateToProject(props.project.worktree)}
        onBlur={() => setOpen(false)}
      >
        <ProjectIcon project={props.project} notify />
      </ContextMenu.Trigger>
      <ContextMenu.Portal mount={!props.mobile ? props.ctx.nav() : undefined}>
        <ContextMenu.Content>
          <ContextMenu.Item onSelect={() => props.ctx.showEditProjectDialog(props.project)}>
            <ContextMenu.ItemLabel>{language.t("common.edit")}</ContextMenu.ItemLabel>
          </ContextMenu.Item>
          <ContextMenu.Item
            data-action="project-workspaces-toggle"
            data-project={base64Encode(props.project.worktree)}
            disabled={props.project.vcs !== "git" && !props.ctx.workspacesEnabled(props.project)}
            onSelect={() => props.ctx.toggleProjectWorkspaces(props.project)}
          >
            <ContextMenu.ItemLabel>
              {props.ctx.workspacesEnabled(props.project)
                ? language.t("sidebar.workspaces.disable")
                : language.t("sidebar.workspaces.enable")}
            </ContextMenu.ItemLabel>
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
    </ContextMenu>
  )

  return (
    // @ts-ignore
    <div use:sortable classList={{ "opacity-30": sortable.isActiveDraggable }}>
      <Show when={preview()} fallback={<Trigger />}>
        <HoverCard
          open={open() && !menu()}
          openDelay={0}
          closeDelay={0}
          placement="right-start"
          gutter={6}
          trigger={<Trigger />}
          onOpenChange={(value) => {
            if (menu()) return
            setOpen(value)
            if (value) props.ctx.setHoverSession(undefined)
          }}
        >
          <div class="-m-3 p-2 flex flex-col w-72">
            <div class="px-4 pt-2 pb-1 flex items-center gap-2">
              <div class="text-14-medium text-text-strong truncate grow">{displayName(props.project)}</div>
              <Tooltip value={language.t("common.close")} placement="top" gutter={6}>
                <IconButton
                  icon="circle-x"
                  variant="ghost"
                  class="shrink-0"
                  data-action="project-close-hover"
                  data-project={base64Encode(props.project.worktree)}
                  aria-label={language.t("common.close")}
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpen(false)
                    props.ctx.closeProject(props.project.worktree)
                  }}
                />
              </Tooltip>
            </div>
            <div class="px-4 pb-2 text-12-medium text-text-weak">{language.t("sidebar.project.recentSessions")}</div>
            <div class="px-2 pb-2 flex flex-col gap-2">
              <Show
                when={workspaceEnabled()}
                fallback={
                  <For each={projectSessions()}>
                    {(session) => (
                      <SessionItem
                        {...props.ctx.sessionProps}
                        session={session}
                        slug={base64Encode(props.project.worktree)}
                        dense
                        mobile={props.mobile}
                        popover={false}
                        children={projectChildren()}
                      />
                    )}
                  </For>
                }
              >
                <For each={workspaces()}>
                  {(directory) => {
                    const sessions = createMemo(() => workspaceSessions(directory))
                    const children = createMemo(() => workspaceChildren(directory))
                    return (
                      <div class="flex flex-col gap-1">
                        <div class="px-2 py-0.5 flex items-center gap-1 min-w-0">
                          <div class="shrink-0 size-6 flex items-center justify-center">
                            <Icon name="branch" size="small" class="text-icon-base" />
                          </div>
                          <span class="truncate text-14-medium text-text-base">{label(directory)}</span>
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
                  setOpen(false)
                  if (selected()) return
                  props.ctx.navigateToProject(props.project.worktree)
                }}
              >
                {language.t("sidebar.project.viewAllSessions")}
              </Button>
            </div>
          </div>
        </HoverCard>
      </Show>
    </div>
  )
}
