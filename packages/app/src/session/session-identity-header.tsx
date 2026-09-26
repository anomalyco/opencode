import type { SessionInfo } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { ProjectAvatar } from "@opencode/ui/project-avatar"
import { Tooltip } from "@opencode/ui/tooltip"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useNavigate } from "@solidjs/router"
import { createMemo, For, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { displayName, errorMessage, getProjectAvatarSource } from "@/shell/layout/helpers"
import { getProjectAvatarVariant, useLayout, type LocalProject } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { useSettingsSurface } from "@/settings/surface"
import { pathKey } from "@/workspaces/path-key"
import { isProjectDirectory, isWorkspaceDirectory } from "@/workspaces/paths"
import { sessionHref } from "@/shell/routes/session"
import { showToast } from "@/shell/notifications/toast"
import { sessionTitle } from "./title"
import "./session-identity-header.css"

export function SessionTitleHeader(props: ParentProps) {
  return (
    <div
      data-session-title
      class="sticky top-0 z-30 w-full bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_48px,transparent)] pb-4 pe-3 ps-2.5"
    >
      {props.children}
    </div>
  )
}

export function SessionProjectMenu(props: {
  project?: Omit<LocalProject, "expanded">
  directory?: string
  workspace: boolean
}) {
  const server = useServer()
  const language = useLanguage()
  const platform = usePlatform()
  const layout = useLayout()
  const settingsSurface = useSettingsSurface()
  const navigate = useNavigate()
  const [state, setState] = createStore({
    open: false,
    projectTruncated: false,
    pathTruncated: false,
    pathFocused: false,
  })
  const projectName = createMemo(() => displayName(props.project ?? { worktree: props.directory ?? "" }))
  const canOpenPath = () =>
    platform.platform === "desktop" && !!platform.openPath && server.isLocal && !!props.directory
  const openPath = () => {
    if (!canOpenPath() || !platform.openPath || !props.directory) return
    void platform.openPath(props.directory).catch((cause: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )
  }
  const openProjectSettings = () => {
    const current = props.project
    if (!current) return
    settingsSurface.openProject({
      server: ServerConnection.key(server.conn),
      project: current.worktree,
    })
  }

  return (
    <Menu
      placement="bottom-start"
      gutter={4}
      shift={-10}
      modal={false}
      open={state.open}
      onOpenChange={(open) => setState({ open, pathFocused: false })}
    >
      <Tooltip placement="bottom" value={<bdi>{projectName()}</bdi>} class="flex shrink-0">
        <Menu.Trigger
          as={IconButton}
          variant="ghost-muted"
          aria-label={projectName()}
          data-slot="session-project-trigger"
          icon={
            <span class="text-v2-icon-icon-muted">
              <Icon name={props.workspace ? "outline-worktree" : "monitor"} />
            </span>
          }
        />
      </Tooltip>
      <Menu.Portal>
        <Menu.Content class="w-max max-w-[min(320px,calc(100vw-16px))]" aria-label={projectName()}>
          <Tooltip
            placement="top"
            gutter={2}
            disabled={!state.projectTruncated}
            class="min-w-0 cursor-default"
            contentClass="session-project-info-tooltip max-w-[min(480px,calc(100vw-16px))] whitespace-normal break-all"
            value={<bdi>{projectName()}</bdi>}
          >
            <Menu.Item
              class="min-w-0 w-full"
              disabled={!props.project}
              onSelect={() => {
                const project = props.project
                if (!project) return
                server.ctx.projects.open(project.worktree)
                layout.home.setSelection({ server: server.key, directory: project.worktree })
                navigate("/")
              }}
            >
              <span class="session-project-link-content">
                <ProjectAvatar
                  class="shrink-0"
                  aria-hidden="true"
                  fallback={projectName()}
                  src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
                  variant={getProjectAvatarVariant(props.project?.icon?.color)}
                />
                <bdi
                  ref={(element) =>
                    createResizeObserver(element, () =>
                      setState("projectTruncated", element.scrollWidth > element.clientWidth),
                    )
                  }
                  class="min-w-0 truncate text-13-medium"
                >
                  {projectName()}
                </bdi>
              </span>
            </Menu.Item>
          </Tooltip>
          <Tooltip
            placement="top"
            gutter={2}
            disabled={!state.pathTruncated}
            forceOpen={state.pathFocused && state.pathTruncated ? true : undefined}
            class="min-w-0 cursor-default"
            contentClass="session-project-info-tooltip max-w-[min(480px,calc(100vw-16px))] whitespace-normal break-all"
            value={<bdi dir="ltr">{props.directory}</bdi>}
          >
            {/* Read-only paths stay in keyboard navigation so their full tooltip remains accessible. */}
            <Menu.Item
              class="session-project-link min-w-0 w-full cursor-default"
              disabled={!props.directory}
              aria-disabled={!canOpenPath()}
              closeOnSelect={canOpenPath()}
              onSelect={openPath}
              onFocus={() => setState("pathFocused", true)}
              onBlur={() => setState("pathFocused", false)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return
                event.preventDefault()
                event.stopPropagation()
                setState({ open: false, pathFocused: false })
              }}
            >
              <span class="session-project-link-content">
                <Icon name="folder" class="shrink-0 text-v2-icon-icon-muted" />
                <bdi
                  ref={(element) =>
                    createResizeObserver(element, () =>
                      setState("pathTruncated", element.scrollWidth > element.clientWidth),
                    )
                  }
                  dir="ltr"
                  class="min-w-0 truncate text-v2-text-text-muted"
                >
                  {props.directory}
                </bdi>
              </span>
              <span data-slot="session-project-open-icon" class="session-project-link-open" aria-hidden="true">
                <Icon name="arrow-up-right" />
              </span>
            </Menu.Item>
          </Tooltip>
          <Menu.Separator />
          <Menu.Item disabled={!props.project} onSelect={openProjectSettings}>
            <Icon name="settings-gear" class="text-v2-icon-icon-muted" />
            {language.t("project.settings.title")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}

export function SessionAncestorTrail(props: {
  sessionID: string
  parentID: string
  parentTitle?: string
  trailing: boolean
}) {
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()
  const language = useLanguage()
  const ancestors = createMemo(() => {
    const path: { id: string; title: string; direct: boolean }[] = []
    const seen = new Set([props.sessionID])
    let id: string | undefined = props.parentID
    while (id && !seen.has(id)) {
      seen.add(id)
      const info = server.ctx.data.session.get(id)
      path.unshift({
        id,
        title:
          sessionTitle(info?.title ?? (id === props.parentID ? props.parentTitle : undefined)) ??
          language.t("session.tab.session"),
        direct: id === props.parentID,
      })
      id = info?.parentID
    }
    return path
  })
  const open = (id: string) => {
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === props.sessionID || item.routeSessionId === props.sessionID),
    )
    if (tab?.type === "session") tabs.rememberSessionRoute(tab, id, server.ctx.data.session.get(id)?.parentID)
    navigate(sessionHref(server.key, id))
  }

  return (
    <div class="flex min-w-0 max-w-full items-center">
      <div
        data-slot="session-title-ancestors"
        class="flex min-w-0 items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <For each={ancestors()}>
          {(ancestor, index) => (
            <>
              <button
                type="button"
                data-slot={ancestor.direct ? "session-title-parent" : "session-title-ancestor"}
                data-session-id={ancestor.id}
                title={ancestor.title}
                dir="auto"
                class="max-w-[min(200px,40vw)] shrink-0 truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                onClick={() => open(ancestor.id)}
              >
                {ancestor.title}
              </button>
              <Show when={index() < ancestors().length - 1}>
                <span
                  data-slot="session-title-separator"
                  class="-translate-y-[0.5px] shrink-0 pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                  aria-hidden="true"
                >
                  /
                </span>
              </Show>
            </>
          )}
        </For>
      </div>
      <Show when={props.trailing}>
        <span
          data-slot="session-title-separator"
          class="-translate-y-[0.5px] shrink-0 pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
          aria-hidden="true"
        >
          /
        </span>
      </Show>
    </div>
  )
}

export function SessionIdentityHeader(props: { sessionID: string; session?: SessionInfo }) {
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const pending = createMemo(() => tabs.pendingSession(server.key, props.sessionID))
  const tab = createMemo(() =>
    tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === server.key &&
        (item.sessionId === props.sessionID || item.routeSessionId === props.sessionID),
    ),
  )
  const info = createMemo(() => {
    const current = tab()
    return current ? tabs.info[tabKey(current)] : undefined
  })
  const parentID = createMemo(() => {
    if (props.session?.parentID) return props.session.parentID
    const current = tab()
    if (current?.type !== "session" || current.routeSessionId !== props.sessionID) return
    return current.routeParentId ?? current.sessionId
  })
  const parent = createMemo(() => {
    const id = parentID()
    return id ? server.ctx.data.session.get(id) : undefined
  })
  const parentTitle = createMemo(() => {
    const id = parentID()
    const current = tab()
    return sessionTitle(
      parent()?.title ?? (current?.type === "session" && current.sessionId === id ? info()?.title : undefined),
    )
  })
  const directory = createMemo(
    () => props.session?.location.directory ?? pending()?.draft.directory ?? info()?.directory,
  )
  const title = createMemo(() =>
    pending()
      ? language.t("session.tab.session")
      : sessionTitle(props.session?.title ?? (parentID() ? undefined : info()?.title)),
  )
  const project = createMemo(() => {
    if (props.session) return server.ctx.projects.forSession(props.session)
    const projects = server.ctx.projects.list()
    const value = directory()
    if (!value) return undefined
    const key = pathKey(value)
    return (
      projects.find(
        (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
      ) ?? server.ctx.sync.data.project.find((item) => isProjectDirectory(item, value))
    )
  })
  const workspaceSession = createMemo(() => !!pending() || isWorkspaceDirectory(project(), directory() ?? ""))
  return (
    <Show when={title() || parentTitle()}>
      <SessionTitleHeader>
        <div class="flex h-12 w-full items-center justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-1">
            <div class="flex min-w-0 w-full flex-1 items-center gap-0.5">
              <SessionProjectMenu project={project()} directory={directory()} workspace={workspaceSession()} />
              <Show when={parentID()}>
                {(id) => (
                  <SessionAncestorTrail
                    sessionID={props.sessionID}
                    parentID={id()}
                    parentTitle={parentTitle()}
                    trailing={!!title()}
                  />
                )}
              </Show>
              <Show when={title()}>
                {(value) => (
                  <h1
                    data-slot={parentID() ? "session-title-child" : undefined}
                    dir="auto"
                    class="w-fit truncate rounded-[6px] px-1 py-1 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base"
                    classList={{ "max-w-[45%] shrink-0": !!parentID() }}
                  >
                    {value()}
                  </h1>
                )}
              </Show>
            </div>
          </div>
        </div>
      </SessionTitleHeader>
    </Show>
  )
}
