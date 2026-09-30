import type { LocationPublicInfo, OpenCode, ModelInfo, ProjectIcon, SessionInfo } from "@opencode/client"
import type { TrayAvatar } from "../../shared/tray-avatar"

export type TraySession = {
  id: string
  title?: string
  directory: string
  cost: number
  status: "question" | "permission" | "working" | "failed" | "interrupted" | "idle"
  detail?: string
  tokens?: number
  context?: number
  model?: string
  project?: { id: string; name?: string; icon?: ProjectIcon }
  placement?: { type: "local" | "worktree"; directory: string }
  avatar?: TrayAvatar
  unread?: boolean
}

export type TraySessions = {
  state: "loading" | "ready" | "offline"
  sessions: TraySession[]
  working: number
  attention: number
  more: boolean
}

export function traySessionGroup(status: TraySession["status"]) {
  if (status === "question" || status === "permission") return "attention"
  return "active"
}

export function traySessionNotification(session: TraySession) {
  return (
    session.status === "question" ||
    session.status === "permission" ||
    (session.status !== "working" && !!session.unread)
  )
}

export async function loadTraySessions(
  client: ReturnType<typeof OpenCode.make>,
  sessionIDs: readonly string[],
  signal: AbortSignal,
): Promise<TraySessions> {
  if (!sessionIDs.length) return { state: "ready", sessions: [], working: 0, attention: 0, more: false }
  const options = { signal }
  const [tabs, active, projects] = await Promise.all([
    Promise.all([...new Set(sessionIDs)].map((sessionID) => client.session.get({ sessionID }, options))),
    client.session.active(options),
    client.project.list(options).catch(() => []),
  ])
  const sessions = tabs.filter((session) => !session.time.archived)
  const byProject = new Map(projects.map((project) => [project.id, project]))
  const roots = new Map<string, Promise<LocationPublicInfo | undefined>>()
  const rows = await Promise.all(
    sessions.map(async (session) => {
      const key = JSON.stringify(session.location)
      const root =
        roots.get(key) ??
        client.location.get({ location: { directory: session.location.directory } }, options).catch(() => undefined)
      roots.set(key, root)
      const [forms, permissions, current] = await Promise.all([
        client.session.form.list({ sessionID: session.id }, options),
        client.permission.list({ sessionID: session.id }, options),
        root,
      ])
      const status: TraySession["status"] = forms.length
        ? "question"
        : permissions.length
          ? "permission"
          : active[session.id]
            ? "working"
            : session.outcome === "failed"
              ? "failed"
              : session.outcome === "interrupted"
                ? "interrupted"
                : "idle"
      return {
        session,
        row: {
          id: session.id,
          title: session.title,
          directory: session.location.directory,
          cost: session.cost,
          status,
          unread:
            !active[session.id] &&
            session.time.idle !== undefined &&
            (session.time.viewed === undefined || session.time.idle > session.time.viewed),
          detail: forms[0]?.title ?? permissions[0]?.action,
          project: byProject.get(session.projectID),
          // Resolve the checkout root, not the session's subdirectory or the
          // project-list canonical path (which may belong to another clone).
          placement: current
            ? {
                type: current.project.directory === current.project.canonical ? "local" : "worktree",
                directory: current.project.directory,
              }
            : undefined,
        } satisfies TraySession,
      }
    }),
  )
  const priority = { attention: 0, active: 1 }
  rows.sort((a, b) => priority[traySessionGroup(a.row.status)] - priority[traySessionGroup(b.row.status)])
  const catalogs = new Map<string, Promise<ModelInfo[]>>()
  return {
    state: "ready",
    working: rows.filter((item) => item.row.status === "working").length,
    attention: rows.filter((item) => traySessionGroup(item.row.status) === "attention").length,
    more: false,
    sessions: await Promise.all(
      rows.map(async ({ session, row }): Promise<TraySession> => {
        const messages = await client.message
          .list({ sessionID: session.id, order: "desc", limit: 10 }, options)
          .catch(() => undefined)
        const message = messages?.data.find((item) => item.type === "assistant" && item.tokens)
        if (message?.type !== "assistant" || !message.tokens) return row
        const key = JSON.stringify(session.location)
        const catalog = catalogs.get(key) ?? models(session)
        catalogs.set(key, catalog)
        const model = (await catalog).find(
          (item) => item.id === message.model.id && item.providerID === message.model.providerID,
        )
        // Match the context indicator in the app: use the most recent measured
        // assistant step, never the session's cumulative usage counters.
        const tokens =
          message.tokens.input +
          message.tokens.output +
          message.tokens.reasoning +
          message.tokens.cache.read +
          message.tokens.cache.write
        return {
          ...row,
          tokens,
          context: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined,
          model: model?.name ?? message.model.id,
        }
      }),
    ),
  }

  function models(session: SessionInfo) {
    return client.model
      .list({ location: { directory: session.location.directory } }, options)
      .then((result) => result.data)
      .catch(() => [])
  }
}
