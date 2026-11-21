import { createMemo, type Accessor } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { sessionStatus } from "@/shell/layout/project-avatar-state"
import { useTabs } from "@/shell/tabs/tabs"

/** Counts open unmuted session tabs in the current window waiting on input or finished unread. */
export function useWindowTaskbarBadgeCount(): Accessor<number> {
  const tabs = useTabs()
  const global = useGlobal()
  const settings = useSettings()

  return createMemo(() =>
    tabs.store
      .filter((tab) => tab.type === "session")
      .reduce((count, tab) => {
        const ctx = global.serverCtx(tab.server)

        if (!ctx || global.sessionPreferences.muted(tab.server, tab.sessionId)) return count
        const session = ctx.data.session.get(tab.sessionId)
        const autoApprove = settings.permissions.autoApproves(projectSettingsKey(ctx.sdk.scope, session?.projectID))
        const status = sessionStatus(ctx, tab.sessionId, { root: true, autoApprove })

        return count + (status === "input" || status === "unread" ? 1 : 0)
      }, 0),
  )
}
