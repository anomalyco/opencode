import type { SessionInfo } from "@opencode-ai/client/promise"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectAvatar } from "@opencode-ai/ui/project-avatar"
import { useNavigate } from "@solidjs/router"
import { createMemo, Show, type ParentProps } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useLanguage } from "@/runtime/i18n/language"
import { displayName, getProjectAvatarSource, projectForSession } from "@/shell/layout/helpers"
import { getProjectAvatarVariant } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { useSettings } from "@/settings/model"
import { pathKey } from "@/workspaces/path-key"
import { isWorkspaceDirectory } from "@/workspaces/paths"
import { sessionHref } from "@/shell/routes/session"
import { sessionTitle } from "./title"
import { TitlebarNavigationMount } from "@/shell/titlebar/navigation-slot"

export function SessionTitleHeader(props: ParentProps<{ navigationEnd?: boolean }>) {
  return (
    <div
      data-session-title
      class="sticky top-0 z-30 flex w-full items-start bg-[linear-gradient(to_bottom,var(--v2-background-bg-base)_var(--shell-header-height,48px),transparent)] pb-4 ps-2.5"
      style={{
        // Match the 28px action buttons' top inset, retaining physical macOS control clearance in RTL.
        "padding-inline-end": "calc((var(--shell-header-height, 48px) - 28px) / 2 + var(--tabs-trailing-inset, 0px))",
      }}
    >
      <TitlebarNavigationMount side="start" />
      <div class="min-w-0 flex-1">{props.children}</div>
      <Show when={props.navigationEnd !== false}>
        <TitlebarNavigationMount side="end" />
      </Show>
    </div>
  )
}

export function SessionIdentityHeader(props: { sessionID: string; session?: SessionInfo }) {
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const pending = createMemo(() => tabs.pendingSession(server.key, props.sessionID))
  const settings = useSettings()
  const navigate = useNavigate()
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
      ? language.t("command.session.new")
      : sessionTitle(props.session?.title ?? (parentID() ? undefined : info()?.title)),
  )
  const project = createMemo(() => {
    const projects = server.ctx.projects.list()
    if (props.session) return projectForSession(props.session, projects)
    const value = directory()
    if (!value) return undefined
    const key = pathKey(value)
    return projects.find(
      (item) => pathKey(item.worktree) === key || item.sandboxes?.some((sandbox) => pathKey(sandbox) === key),
    )
  })
  const showProjectIcon = () =>
    import.meta.env.VITE_OPENCODE_CHANNEL !== "prod" && settings.general.showProjectIcon() && !!directory()
  const workspaceSession = createMemo(() => !!pending() || isWorkspaceDirectory(project(), directory() ?? ""))
  const navigateParent = () => {
    const id = parentID()
    const current = tab()
    if (!id || current?.type !== "session") return
    tabs.rememberSessionRoute(current, id, parent()?.parentID)
    navigate(sessionHref(server.key, id))
  }

  return (
    <Show when={title() || parentTitle() || showProjectIcon()}>
      <SessionTitleHeader>
        <div class="flex h-[var(--shell-header-height,48px)] w-full items-center justify-between gap-2">
          <div class="flex min-w-0 flex-1 items-center gap-1">
            <div class="flex min-w-0 w-full flex-1 items-center">
              <span
                classList={{
                  "flex size-6 shrink-0 items-center justify-center": true,
                  "text-v2-icon-icon-accent": workspaceSession() && !showProjectIcon(),
                  "text-v2-icon-icon-muted": !workspaceSession() && !showProjectIcon(),
                }}
              >
                <Show
                  when={showProjectIcon()}
                  fallback={<Icon name={workspaceSession() ? "workspace-isolated" : "monitor"} />}
                >
                  <ProjectAvatar
                    fallback={displayName(project() ?? { worktree: directory() ?? "" })}
                    src={getProjectAvatarSource(project()?.id, project()?.icon)}
                    variant={getProjectAvatarVariant(project()?.icon?.color)}
                  />
                </Show>
              </span>
              <Show when={parentTitle()}>
                {(value) => (
                  <button
                    type="button"
                    data-slot="session-title-parent"
                    dir="auto"
                    class="min-w-0 max-w-[40%] truncate pl-2 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:text-v2-text-text-muted"
                    onClick={navigateParent}
                  >
                    {value()}
                  </button>
                )}
              </Show>
              <Show when={parentTitle() && title()}>
                <span
                  data-slot="session-title-separator"
                  class="-translate-y-[0.5px] pl-2 pr-1 text-[11px] font-medium text-v2-text-text-faint"
                  aria-hidden="true"
                >
                  /
                </span>
              </Show>
              <Show when={title()}>
                {(value) => (
                  <h1
                    data-slot={parentID() ? "session-title-child" : undefined}
                    dir="auto"
                    class="w-fit truncate rounded-[6px] px-2 py-1 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base"
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
