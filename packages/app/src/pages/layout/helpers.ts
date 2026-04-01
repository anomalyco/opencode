import { getFilename } from "@opencode-ai/util/path"
import { type PermissionRequest, type QuestionRequest, type Session } from "@opencode-ai/sdk/v2/client"
import { sessionPermissionRequest, sessionQuestionRequest } from "../session/composer/session-request-tree"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

type AttentionStore = SessionStore & {
  permission?: Record<string, PermissionRequest[] | undefined>
  question?: Record<string, QuestionRequest[] | undefined>
}

export type Attention = "idle" | "working" | "permission" | "question" | "error" | "unseen"

export const workspaceKey = (directory: string) => {
  const value = directory.replaceAll("\\", "/")
  const drive = value.match(/^([A-Za-z]:)\/+$/)
  if (drive) return `${drive[1]}/`
  if (/^\/+$/i.test(value)) return "/"
  return value.replace(/\/+$/, "")
}

function sortSessions(now: number) {
  const oneMinuteAgo = now - 60 * 1000
  return (a: Session, b: Session) => {
    const aUpdated = a.time.updated ?? a.time.created
    const bUpdated = b.time.updated ?? b.time.created
    const aRecent = aUpdated > oneMinuteAgo
    const bRecent = bUpdated > oneMinuteAgo
    if (aRecent && bRecent) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    if (aRecent && !bRecent) return -1
    if (!aRecent && bRecent) return 1
    return bUpdated - aUpdated
  }
}

const isRootVisibleSession = (session: Session, directory: string) =>
  workspaceKey(session.directory) === workspaceKey(directory) && !session.parentID && !session.time?.archived

const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, now: number) => roots(store).sort(sortSessions(now))

export const latestRootSession = (stores: SessionStore[], now: number) =>
  stores.flatMap(roots).sort(sortSessions(now))[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const projectAttention = (input: {
  permission: boolean
  question: boolean
  error: boolean
  unseen: boolean
}) => {
  if (input.permission) return "permission"
  if (input.question) return "question"
  if (input.error) return "error"
  if (input.unseen) return "unseen"
  return "idle"
}

export const sessionAttention = (input: {
  permission: boolean
  question: boolean
  error: boolean
  unseen: boolean
  working: boolean
}): Attention => {
  if (input.permission) return "permission"
  if (input.question) return "question"
  if (input.error) return "error"
  if (input.unseen) return "unseen"
  if (input.working) return "working"
  return "idle"
}

export type Awaiting = {
  session: Session
  reason: "permission" | "question"
}

export const attentionTitle = (base: string, count: number) => (count > 0 ? `(${count}) ${base}` : base)

export const awaitingSessions = (
  store: AttentionStore,
  now: number,
  include: (item: PermissionRequest) => boolean = () => true,
): Awaiting[] => {
  const result: Awaiting[] = []
  for (const session of sortedRootSessions(store, now)) {
    const permission = sessionPermissionRequest(store.session ?? [], store.permission ?? {}, session.id, include)
    if (permission) {
      result.push({ session, reason: "permission" })
      continue
    }
    const question = sessionQuestionRequest(store.session ?? [], store.question ?? {}, session.id)
    if (!question) continue
    result.push({ session, reason: "question" })
  }
  return result
}

export const childMapByParent = (sessions: Session[] | undefined) => {
  const map = new Map<string, string[]>()
  for (const session of sessions ?? []) {
    if (!session.parentID) continue
    const existing = map.get(session.parentID)
    if (existing) {
      existing.push(session.id)
      continue
    }
    map.set(session.parentID, [session.id])
  }
  return map
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree)

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = workspaceKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = workspaceKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = workspaceKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
