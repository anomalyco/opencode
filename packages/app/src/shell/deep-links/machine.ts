// `opencode://` links opened with the desktop app. Both open on the app's own server, the one on this computer:
// - `open-project?directory=<folder>` opens the folder as a project, in a new session.
// - `new-session?directory=<folder>&prompt=<text>` does the same with the prompt typed in, not sent.
// A link that arrives before that server can open projects (one that started the app) waits for it.

export type DeepLink =
  | { readonly type: "open-project"; readonly directory: string }
  | { readonly type: "new-session"; readonly directory: string; readonly prompt: string | undefined }

export type DeepLinkState =
  | { readonly type: "waiting"; readonly queued: readonly DeepLink[] }
  | { readonly type: "ready" }

export type DeepLinkEvent =
  | { readonly type: "links.received"; readonly urls: readonly string[] }
  | { readonly type: "server.ready" }
  | { readonly type: "server.lost" }

export type DeepLinkEffect = { readonly type: "open"; readonly link: DeepLink }

export type DeepLinkTransition = { readonly state: DeepLinkState; readonly effects: readonly DeepLinkEffect[] }

export const INITIAL_DEEP_LINK_STATE: DeepLinkState = { type: "waiting", queued: [] }

const READY: DeepLinkState = { type: "ready" }

export function transitionDeepLinks(state: DeepLinkState, event: DeepLinkEvent): DeepLinkTransition {
  if (event.type === "links.received") {
    const links = event.urls.flatMap((url) => parseDeepLink(url) ?? [])

    if (links.length === 0) return { state, effects: [] }

    if (state.type === "ready") return { state, effects: links.map(open) }

    return { state: { type: "waiting", queued: [...state.queued, ...links] }, effects: [] }
  }

  if (event.type === "server.ready") {
    if (state.type === "ready") return { state, effects: [] }

    return { state: READY, effects: state.queued.map(open) }
  }

  if (state.type === "waiting") return { state, effects: [] }

  return { state: INITIAL_DEEP_LINK_STATE, effects: [] }
}

export function parseDeepLink(value: string): DeepLink | undefined {
  if (!URL.canParse(value)) return
  const url = new URL(value)

  if (url.protocol !== "opencode:") return
  const directory = url.searchParams.get("directory")

  if (!directory || /[\u0000-\u001f\u007f]/.test(directory)) return

  if (url.hostname === "open-project") return { type: "open-project", directory }

  if (url.hostname !== "new-session") return

  return { type: "new-session", directory, prompt: url.searchParams.get("prompt") || undefined }
}

function open(link: DeepLink): DeepLinkEffect {
  return { type: "open", link }
}
