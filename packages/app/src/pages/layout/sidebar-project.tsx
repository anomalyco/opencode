import { createMemo, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/util/encode"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createSortable } from "@thisbeyond/solid-dnd"
import { useLayout, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { ProjectIcon } from "./sidebar-items"
import { displayName } from "./helpers"
import { projectSelected } from "./sidebar-project-helpers"

// Stable 1..6 hash from project path; consumed by Arc theme via [data-rail-hue].
// Inert on other themes (no selector reads the attribute).
function railHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0
  return Math.abs(h) % 6 + 1
}

export type ProjectSidebarContext = {
  currentDir: Accessor<string>
  sidebarReduced: Accessor<boolean>
  consumeProjectClick: () => boolean
  navigateToProject: (directory: string) => void
  closeProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  workspaceIds: (project: LocalProject) => string[]
}

export const ProjectDragOverlay = (props: {
  projects: Accessor<LocalProject[]>
  activeProject: Accessor<string | undefined>
}): JSX.Element => {
  const project = createMemo(() => props.projects().find((p) => p.worktree === props.activeProject()))
  return (
    <Show when={project()}>
      {(p) => (
        <div class="bg-background-base rounded-xl p-1" style={{ cursor: "grabbing" }}>
          <ProjectIcon project={p()} />
        </div>
      )}
    </Show>
  )
}

const ProjectTile = (props: {
  project: LocalProject
  mobile?: boolean
  sidebarReduced: Accessor<boolean>
  selected: Accessor<boolean>
  active: Accessor<boolean>
  dirs: Accessor<string[]>
  consumeProjectClick: () => boolean
  navigateToProject: (directory: string) => void
  showEditProjectDialog: (project: LocalProject) => void
  toggleProjectWorkspaces: (project: LocalProject) => void
  workspacesEnabled: (project: LocalProject) => boolean
  closeProject: (directory: string) => void
  setMenu: (value: boolean) => void
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

  const name = () => displayName(props.project)

  return (
    <ContextMenu
      modal
      onOpenChange={(value) => {
        props.setMenu(value)
      }}
    >
      <Tooltip
        openDelay={0}
        placement={props.mobile ? "bottom" : "right"}
        contentClass="max-w-none border-border-strong-base bg-surface-float-base-hover shadow-lg"
        value={<div class="px-2 py-1 text-14-medium text-text-invert-strong whitespace-nowrap">{name()}</div>}
        gutter={10}
      >
        <ContextMenu.Trigger
          as="button"
          type="button"
          aria-label={name()}
          aria-current={props.selected() ? "true" : undefined}
          data-action="project-switch"
          data-project={base64Encode(props.project.worktree)}
          data-rail-hue={railHue(props.project.worktree)}
          classList={{
            "flex items-center justify-center size-10 p-1 rounded-xl overflow-hidden cursor-pointer": true,
            "transition-all duration-150": !props.sidebarReduced(),
            "bg-surface-interactive-selected border-2 border-border-brand-base": props.selected(),
            "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-base hover:scale-105":
              !props.sidebarReduced() && !props.selected() && !props.active(),
            "bg-surface-base-hover border border-border-base": !props.selected() && props.active(),
          }}
          onPointerDown={(event) => {
            if (event.button !== 2 && !(event.button === 0 && event.ctrlKey)) return
            event.preventDefault()
          }}
          onClick={() => {
            if (props.consumeProjectClick()) return
            if (props.selected()) {
              layout.sidebar.toggle()
              return
            }
            props.navigateToProject(props.project.worktree)
          }}
        >
          <ProjectIcon project={props.project} notify />
        </ContextMenu.Trigger>
      </Tooltip>
      <ContextMenu.Portal>
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

export const SortableProject = (props: {
  project: LocalProject
  mobile?: boolean
  ctx: ProjectSidebarContext
}): JSX.Element | null => {
  if (!props.project?.worktree) return null
  const sortable = createSortable(props.project.worktree)
  const selected = createMemo(() =>
    projectSelected(props.ctx.currentDir(), props.project.worktree, props.project.sandboxes),
  )
  const language = useLanguage()
  const dirs = createMemo(() => props.ctx.workspaceIds(props.project))
  const [state, setState] = createStore({ menu: false })
  const tile = () => (
    <ProjectTile
      project={props.project}
      mobile={props.mobile}
      sidebarReduced={props.ctx.sidebarReduced}
      selected={selected}
      active={() => state.menu}
      dirs={dirs}
      consumeProjectClick={props.ctx.consumeProjectClick}
      navigateToProject={props.ctx.navigateToProject}
      showEditProjectDialog={props.ctx.showEditProjectDialog}
      toggleProjectWorkspaces={props.ctx.toggleProjectWorkspaces}
      workspacesEnabled={props.ctx.workspacesEnabled}
      closeProject={props.ctx.closeProject}
      setMenu={(value) => setState("menu", value)}
      language={language}
    />
  )

  return (
    <div
      use:sortable
      class="flex w-full justify-center py-1.5"
      style={{
        transition: sortable.isActiveDraggable ? undefined : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
        "will-change": "transform",
      }}
      classList={{ "opacity-30": sortable.isActiveDraggable }}
    >
      {tile()}
    </div>
  )
}
