import type { SessionInfo } from "@opencode-ai/client/promise"
import { Icon } from "@opencode-ai/ui/icon"
import { ProjectAvatar } from "@opencode-ai/ui/project-avatar"
import { createMemo, Show, type ParentProps } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { displayName, getProjectAvatarSource, projectForSession } from "@/shell/layout/helpers"
import { getProjectAvatarVariant } from "@/shell/state/layout"
import { tabKey, useTabs } from "@/shell/tabs/tabs"
import { useSettings } from "@/settings/model"
import { pathKey } from "@/workspaces/path-key"
import { isWorkspaceDirectory } from "@/workspaces/paths"
import { sessionTitle } from "./title"

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

export function SessionIdentityHeader(props: { sessionID: string; session?: SessionInfo }) {
  const server = useServer()
  const tabs = useTabs()
  const settings = useSettings()
  const info = createMemo(
    () => tabs.info[tabKey({ type: "session", server: server.key, sessionId: props.sessionID })],
  )
  const directory = createMemo(() => props.session?.location.directory ?? info()?.directory)
  const title = createMemo(() => sessionTitle(props.session?.title ?? info()?.title))
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
  const workspaceSession = createMemo(() => isWorkspaceDirectory(project(), directory() ?? ""))

  return (
    <Show when={title() || showProjectIcon()}>
      <SessionTitleHeader>
        <div class="flex h-12 w-full items-center justify-between gap-2">
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
              <Show when={title()}>
                {(value) => (
                  <h1
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
