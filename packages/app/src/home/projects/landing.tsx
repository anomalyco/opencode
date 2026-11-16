import { Button } from "@opencode/ui/button"
import { displayName } from "@opencode/ui/project-avatar"
import { uuid } from "@opencode/util/uuid"
import { Navigate, useLocation } from "@solidjs/router"
import { Show, untrack } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServers } from "@/runtime/server/registry"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { tabHref, useTabs } from "@/shell/tabs/tabs"
import type { LayoutRoute } from "@/shell/state/layout"
import { useProjectBrowser } from "./browse"
import { useProjectStart } from "./start"

export function ProjectLanding() {
  const tabs = useTabs()

  const location = useLocation<{ source?: LayoutRoute }>()

  return (
    <Show when={tabs.restoreReady()}>
      {(_) => {
        // Restore once. Opening a tab from this screen already handles navigation.
        const tab = untrack(() => tabs.restoreTab(location.state?.source))

        return tab ? <Navigate href={tabHref(tab)} /> : <EmptyProjects />
      }}
    </Show>
  )
}

function EmptyProjects() {
  const language = useLanguage()

  const servers = useServers()

  const browse = useProjectBrowser()

  const action = useProjectStart()

  return (
    <SessionRouteFrame padded>
      <SessionPanelFrame raised>
        <div class="m-auto flex max-w-full flex-col items-center gap-3 px-6 text-center">
          <Button
            size="large"
            variant="neutral"
            disabled={action.target().type === "loading"}
            onClick={() => action.start(uuid())}
          >
            {language.t(startLabels[action.target().type])}
          </Button>
          <div class="max-w-full break-words text-13-regular text-v2-text-text-muted">
            <Show when={action.target().project}>
              {(project) => (
                <>
                  <bdi>{displayName(project())}</bdi>
                  <span aria-hidden="true"> · </span>
                </>
              )}
            </Show>
            <Show when={action.target().connection}>{(conn) => <bdi>{servers.label(conn())}</bdi>}</Show>
          </div>
          <Button variant="ghost-muted" onClick={() => browse()}>
            {language.t("project.browse.title")}
          </Button>
        </div>
      </SessionPanelFrame>
    </SessionRouteFrame>
  )
}

const startLabels = {
  loading: "common.loading",
  new: "command.session.new",
  add: "session.new.project.add",
  reconnect: "project.start.reconnect",
} as const
