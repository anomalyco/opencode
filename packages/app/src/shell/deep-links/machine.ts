// `opencode://` links opened with the desktop app. Both open on the app's own server, the one on this computer:
// - `open-project?directory=<folder>` opens the folder as a project, in a new session.
// - `new-session?directory=<folder>&prompt=<text>` does the same with the prompt typed in, not sent.
// Each link shows its folder and opens once the user accepts. Links are asked about one at a time, in the order they came.
// A link accepted before that server can open projects (one that started the app) waits for it.

export type DeepLink =
  | { readonly type: "open-project"; readonly directory: string }
  | { readonly type: "new-session"; readonly directory: string; readonly prompt: string | undefined }

type DeepLinkConfirm =
  | { readonly status: "idle"; readonly attempt: number }
  | {
      readonly status: "asking"
      readonly attempt: number
      readonly link: DeepLink
      readonly queued: readonly DeepLink[]
    }

type DeepLinkServer =
  | { readonly status: "waiting"; readonly accepted: readonly DeepLink[] }
  | { readonly status: "ready" }

export type DeepLinkState = { readonly confirm: DeepLinkConfirm; readonly server: DeepLinkServer }

export type DeepLinkEvent =
  | { readonly type: "links.received"; readonly urls: readonly string[] }
  | { readonly type: "link.accepted"; readonly attempt: number }
  | { readonly type: "link.declined"; readonly attempt: number }
  | { readonly type: "server.ready" }
  | { readonly type: "server.lost" }

export type DeepLinkEffect =
  | { readonly type: "ask"; readonly attempt: number; readonly link: DeepLink }
  | { readonly type: "open"; readonly link: DeepLink }

export type DeepLinkTransition = { readonly state: DeepLinkState; readonly effects: readonly DeepLinkEffect[] }

const WAITING: DeepLinkServer = { status: "waiting", accepted: [] }

const READY: DeepLinkServer = { status: "ready" }

export const INITIAL_DEEP_LINK_STATE: DeepLinkState = { confirm: { status: "idle", attempt: 0 }, server: WAITING }

export function transitionDeepLinks(state: DeepLinkState, event: DeepLinkEvent): DeepLinkTransition {
  if (event.type === "links.received") {
    const links = event.urls.flatMap((url) => parseDeepLink(url) ?? [])

    if (links.length === 0) return { state, effects: [] }

    if (state.confirm.status === "asking") {
      const confirm = { ...state.confirm, queued: [...state.confirm.queued, ...links] }

      return { state: { ...state, confirm }, effects: [] }
    }

    return ask(state, state.confirm.attempt, links)
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

  if (state.server.status === "waiting") return { state, effects: [] }

  return { state: { ...state, server: WAITING }, effects: [] }
}

export function parseDeepLink(value: string): DeepLink | undefined {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (url.protocol !== "opencode:") return
  const directory = url.searchParams.get("directory")

  if (!directory || !isLocalDirectory(directory)) return

  if (url.hostname === "open-project") return { type: "open-project", directory }

  if (url.hostname !== "new-session") return

  return { type: "new-session", directory, prompt: url.searchParams.get("prompt") || undefined }
}

// Asks about the first of `links`, or goes idle when there are none.
function ask(state: DeepLinkState, attempt: number, links: readonly DeepLink[]): DeepLinkTransition {
  const link = links[0]

  if (!link) return { state: { ...state, confirm: { status: "idle", attempt } }, effects: [] }

  const confirm = { status: "asking" as const, attempt: attempt + 1, link, queued: links.slice(1) }

  return { state: { ...state, confirm }, effects: [{ type: "ask", attempt: confirm.attempt, link }] }
}

// An absolute folder on this computer: `/…` or `C:\…`. Not relative (`repo`, `~/repo`, `C:repo`, `..` segments),
// not a share (`\\host\share`, `//host/share`, macOS `/net/<host>`), and without control or bidirectional characters,
// so the dialog shows the folder as it opens.
function isLocalDirectory(directory: string) {
  if (/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(directory)) return false

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
