import { createMemo, type Accessor } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { useGlobal, useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { sessionPermissionRequest, sessionFormRequest } from "@/session/requests/session-request-tree"
import { needsUser } from "@/session/requests/auto-approve-machine"
import { ServerConnection } from "@/runtime/server/registry"
import { projectSettingsKey, useSettings } from "@/settings/model"

type ServerData = ServerCtx["data"]

// Without a server (no session in view) the session reads as idle and read.
export function useSessionTabAvatarState(
  server: Accessor<ServerConnection.Key | undefined>,
  sessionId: Accessor<string>,
  root?: Accessor<boolean>,
  snapshot?: Accessor<SessionInfo | undefined>,
) {
  const global = useGlobal()
  const settings = useSettings()
  const connection = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === server()))
  const serverCtx = useServerCtx(connection)

  const needsAttention = createMemo(() => {
    const ctx = serverCtx()

    if (!ctx) return false

    const project = projectSettingsKey(ctx.sdk.scope, ctx.data.session.get(sessionId())?.projectID)

    return attention(ctx, sessionId(), !!root?.(), settings.permissions.autoApproves(project))
  })

  const unread = createMemo(
    () => needsAttention() || (serverCtx()?.notification.session.unread(sessionId(), snapshot?.()) ?? false),
  )

  const loading = createMemo(() => {
    const data = serverCtx()?.data

    if (!data) return false

    if (needsAttention()) return false

    return running(data, sessionId(), !!root?.())
  })

  return { unread, loading, attention: needsAttention }
}

// The pending permission and form request that waits on the user anywhere in the session (or its family, for roots).
// A permission counts by the same rule as the dock, so one auto-approve gave up on still marks the session.
export function sessionRequests(ctx: ServerCtx, sessionId: string, root: boolean, autoApprove: boolean) {
  const data = ctx.data

  const sessions = root
    ? [...new Set([sessionId, ...data.session.family(sessionId)])].flatMap((id) => {
        const info = data.session.get(id)

        return info ? [info] : []
      })
    : data.session.list()

  return {
    permission: sessionPermissionRequest(sessions, data.session.permission.list, sessionId, (item) =>
      needsUser(ctx.autoApprove.state(item.id), autoApprove),
    ),
    form: sessionFormRequest(sessions, data.session.form.list, sessionId),
  }
}

export type SessionSidebarStatus = "input" | "failed" | "unread" | "running" | "idle"

// The same status the session tab avatar shows, readable for many sessions at once (to filter and sort the sidebar).
export function sessionStatus(
  ctx: ServerCtx,
  sessionId: string,
  input: { root: boolean; autoApprove: boolean; snapshot?: SessionInfo },
): SessionSidebarStatus {
  if (attention(ctx, sessionId, input.root, input.autoApprove)) return "input"

  if (running(ctx.data, sessionId, input.root)) return "running"

  if (ctx.notification.session.unread(sessionId, input.snapshot)) return "unread"

  if ((ctx.data.session.get(sessionId) ?? input.snapshot)?.outcome === "failed") return "failed"

  return "idle"
}

function attention(ctx: ServerCtx, sessionId: string, root: boolean, autoApprove: boolean) {
  const requests = sessionRequests(ctx, sessionId, root, autoApprove)

  return !!requests.permission || !!requests.form
}

// A root runs while any session in its family is busy.
function running(data: ServerData, sessionId: string, root: boolean) {
  if (root)
    return data.session
      .list()
      .some((session) => data.session.root(session.id) === sessionId && sessionBusy(data, session.id))

  return sessionBusy(data, sessionId)
}

export type SessionRequests = ReturnType<typeof sessionRequests>

// Like the TUI, work waiting in the inbox counts as busy; parked synthetic context does not.
export function sessionBusy(data: ServerData, sessionId: string) {
  return (
    data.session.status(sessionId) === "running" ||
    data.session.pending.list(sessionId).some((item) => item.type !== "synthetic")
  )
}
