// `opencode://` links opened with the desktop app:
// - `open-project?directory=<folder>` opens the folder as a project, in a new session, on this computer's server.
// - `new-session?directory=<folder>&prompt=<text>` does the same with the prompt typed in, not sent.
// - `session/<sessionID>[?server=<url>]` opens an existing session on a configured server without adding a server or folder.
// Directory links show their folder and open once the user accepts, one at a time in the order they came.
// Links that arrive before their target server is ready (for example, links that started the app) wait for it.

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/

const MAX_SESSION_ID_LENGTH = 256

export type DirectoryDeepLink =
  | { readonly type: "open-project"; readonly directory: string }
  | { readonly type: "new-session"; readonly directory: string; readonly prompt: string | undefined }

export type SessionDeepLink = {
  readonly type: "session"
  readonly sessionID: string
  readonly server: string | undefined
}

export type DeepLink = DirectoryDeepLink | SessionDeepLink

type DeepLinkConfirm =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "asking"
      readonly attempt: number
      readonly link: DirectoryDeepLink
      readonly queued: readonly DirectoryDeepLink[]
    }

type DeepLinkServer =
  | { readonly status: "waiting"; readonly accepted: readonly DirectoryDeepLink[] }
  | { readonly status: "ready" }

type DeepLinkSessions =
  | { readonly status: "waiting"; readonly queued: readonly SessionDeepLink[] }
  | { readonly status: "ready" }

export type DeepLinkState = {
  readonly confirm: DeepLinkConfirm
  readonly server: DeepLinkServer
  readonly sessions: DeepLinkSessions
}

export type DeepLinkEvent =
  | { readonly type: "links.received"; readonly urls: readonly string[] }
  | { readonly type: "link.accepted"; readonly attempt: number }
  | { readonly type: "link.declined"; readonly attempt: number }
  | { readonly type: "server.ready" }
  | { readonly type: "server.lost" }
  | { readonly type: "sessions.ready" }
  | { readonly type: "sessions.lost" }

export type DeepLinkEffect =
  | { readonly type: "ask"; readonly attempt: number; readonly link: DirectoryDeepLink }
  | { readonly type: "open"; readonly link: DeepLink }

export type DeepLinkTransition = { readonly state: DeepLinkState; readonly effects: readonly DeepLinkEffect[] }

const WAITING: DeepLinkServer = { status: "waiting", accepted: [] }

const READY: DeepLinkServer = { status: "ready" }

const SESSIONS_WAITING: DeepLinkSessions = { status: "waiting", queued: [] }

const SESSIONS_READY: DeepLinkSessions = { status: "ready" }

export const INITIAL_DEEP_LINK_STATE: DeepLinkState = {
  confirm: { status: "idle", attempt: 0 },
  server: WAITING,
  sessions: SESSIONS_WAITING,
}

export function transitionDeepLinks(state: DeepLinkState, event: DeepLinkEvent): DeepLinkTransition {
  if (event.type === "links.received") {
    const links = event.urls.flatMap((url) => parseDeepLink(url) ?? [])

    if (links.length === 0) return { state, effects: [] }

    const sessionLinks = links.filter((link): link is SessionDeepLink => link.type === "session")
    const directoryLinks = links.filter((link): link is DirectoryDeepLink => link.type !== "session")

    const sessionEffects = sessionLinks.length > 0 && state.sessions.status === "ready" ? sessionLinks.map(open) : []

    const sessions: DeepLinkSessions =
      sessionLinks.length > 0 && state.sessions.status === "waiting"
        ? { status: "waiting", queued: [...state.sessions.queued, ...sessionLinks] }
        : state.sessions

    const withSessions: DeepLinkState = sessions === state.sessions ? state : { ...state, sessions }

    if (directoryLinks.length === 0) return { state: withSessions, effects: sessionEffects }

    if (withSessions.confirm.status === "asking") {
      const confirm = { ...withSessions.confirm, queued: [...withSessions.confirm.queued, ...directoryLinks] }

      return { state: { ...withSessions, confirm }, effects: sessionEffects }
    }

    const asked = ask(withSessions, withSessions.confirm.attempt, directoryLinks)

    return { state: asked.state, effects: [...sessionEffects, ...asked.effects] }
  }

  if (event.type === "link.accepted" || event.type === "link.declined") {
    if (state.confirm.status !== "asking" || state.confirm.attempt !== event.attempt) return { state, effects: [] }

    const next = ask(state, event.attempt, state.confirm.queued)

    if (event.type === "link.declined") return next

    const link = state.confirm.link

    if (state.server.status === "ready") return { state: next.state, effects: [open(link), ...next.effects] }

    const server = { status: "waiting" as const, accepted: [...state.server.accepted, link] }

    return { state: { ...next.state, server }, effects: next.effects }
  }

  if (event.type === "server.ready") {
    if (state.server.status === "ready") return { state, effects: [] }

    return { state: { ...state, server: READY }, effects: state.server.accepted.map(open) }
  }

  if (event.type === "server.lost") {
    if (state.server.status === "waiting") return { state, effects: [] }

    return { state: { ...state, server: WAITING }, effects: [] }
  }

  if (event.type === "sessions.ready") {
    if (state.sessions.status === "ready") return { state, effects: [] }

    return { state: { ...state, sessions: SESSIONS_READY }, effects: state.sessions.queued.map(open) }
  }

  if (state.sessions.status === "waiting") return { state, effects: [] }

  return { state: { ...state, sessions: SESSIONS_WAITING }, effects: [] }
}

export function parseDeepLink(value: string): DeepLink | undefined {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (url.protocol !== "opencode:") return

  if (url.hostname === "session") return parseSessionDeepLink(value, url)

  const directory = url.searchParams.get("directory")

  if (!directory || !isLocalDirectory(directory)) return

  if (url.hostname === "open-project") return { type: "open-project", directory }

  if (url.hostname !== "new-session") return

  return { type: "new-session", directory, prompt: url.searchParams.get("prompt") || undefined }
}

export function normalizeDeepLinkServerUrl(value: string | null | undefined) {
  if (!value) return
  const trimmed = value.trim()

  if (!trimmed || CONTROL_OR_BIDI.test(trimmed) || !URL.canParse(trimmed)) return
  const parsed = new URL(trimmed)

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return

  if (parsed.username || parsed.password || parsed.search || parsed.hash) return

  const pathname = parsed.pathname.replace(/\/+$/, "")

  return `${parsed.origin}${pathname}`
}

// Reads `opencode://session/<sessionID>[?server=<url>]` from the raw input path before URL dot-segment
// normalization so traversal segments like `../` are rejected rather than collapsed.
function parseSessionDeepLink(value: string, url: URL): SessionDeepLink | undefined {
  const afterScheme = value.slice(url.protocol.length + 2)
  const authorityAndPath = afterScheme.split(/[?#]/, 1)[0] ?? ""
  const slash = authorityAndPath.indexOf("/")

  if (slash === -1) return
  const rawPath = authorityAndPath.slice(slash + 1)
  const rawSegment = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath

  if (!rawSegment || rawSegment.includes("/") || rawSegment.includes("\\")) return

  const sessionID = decodeSegment(rawSegment)

  if (!sessionID || !isValidSessionID(sessionID)) return

  if (!url.searchParams.has("server")) return { type: "session", sessionID, server: undefined }

  const server = normalizeDeepLinkServerUrl(url.searchParams.get("server"))

  if (!server) return

  return { type: "session", sessionID, server }
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return
  }
}

function isValidSessionID(sessionID: string) {
  if (sessionID.length === 0 || sessionID.length > MAX_SESSION_ID_LENGTH) return false

  if (sessionID === "." || sessionID === ".." || sessionID.includes("..")) return false

  if (CONTROL_OR_BIDI.test(sessionID) || /[\s/\\]/.test(sessionID)) return false

  return true
}

// Asks about the first of `links`, or goes idle when there are none.
function ask(state: DeepLinkState, attempt: number, links: readonly DirectoryDeepLink[]): DeepLinkTransition {
  const link = links[0]

  if (!link) return { state: { ...state, confirm: { status: "idle", attempt } }, effects: [] }

  const confirm = { status: "asking" as const, attempt: attempt + 1, link, queued: links.slice(1) }

  return { state: { ...state, confirm }, effects: [{ type: "ask", attempt: confirm.attempt, link }] }
}

// An absolute folder on this computer: `/…` or `C:\…`. Not relative (`repo`, `~/repo`, `C:repo`, `..` segments),
// not a share (`\\host\share`, `//host/share`, macOS `/net/<host>`), and without control or bidirectional characters,
// so the dialog shows the folder as it opens.
function isLocalDirectory(directory: string) {
  if (CONTROL_OR_BIDI.test(directory)) return false

  if (/^[\\/]{2}/.test(directory)) return false

  if (!/^(?:\/|[a-z]:[\\/])/i.test(directory)) return false

  const segments = directory.split(/[\\/]/)

  if (segments.some((segment) => segment === "." || segment === "..")) return false

  if (directory.startsWith("/") && segments[1]?.toLowerCase() === "net") return false

  return true
}

function open(link: DeepLink): DeepLinkEffect {
  return { type: "open", link }
}
