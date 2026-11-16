// What a tab waits on the user for, besides a page dialog (the dialog gate owns those): a site's permission request,
// a site's sign-in, the page asking before the user leaves it, and the system refusing a device the user allowed.
// Oldest first; the pane shows one at a time with a count of the rest. A request with the key of one that waits joins
// it instead of queueing again. Every item ends with an answer: the user's, its deadline, or a navigation or close
// that clears it, each settled exactly once.
import { previewScheme } from "./scheme"
import { originOf, type PermissionKind } from "./site-permissions"

export type Waiting =
  | {
      readonly kind: "permission"
      readonly id: number
      readonly key: string
      readonly origin: string
      readonly permissions: readonly PermissionKind[]
      /** The decision may be kept for later visits; false for local previews and a remote server's own machine. */
      readonly remember: boolean
    }
  | {
      readonly kind: "auth"
      readonly id: number
      readonly key: string
      readonly host: string
      readonly realm: string
      /** The site refused the last user name and password it was given. */
      readonly failed: boolean
    }
  | { readonly kind: "leave"; readonly id: number; readonly key: string }
  | { readonly kind: "system"; readonly id: number; readonly key: string; readonly device: "camera" | "microphone" }

export type WaitingRequest = Waiting extends infer Item ? (Item extends Waiting ? Omit<Item, "id"> : never) : never

export type PromptState = { readonly next: number; readonly items: readonly Waiting[] }

export type PromptEvent =
  | { readonly type: "requested"; readonly request: WaitingRequest }
  /** The user answered, or its deadline passed. */
  | { readonly type: "settled"; readonly id: number }
  /** A navigation or close ends these kinds, or every item. */
  | { readonly type: "cleared"; readonly kinds?: readonly Waiting["kind"][] }

export type PromptTransition = {
  readonly state: PromptState
  /** For `requested`: the item the request waits on, a new one or the one it joined. */
  readonly id?: number
  /** The items that ended, which the driver answers with their default. */
  readonly ended: readonly number[]
}

export const initialPrompts: PromptState = { next: 1, items: [] }

export function transitionPrompts(state: PromptState, event: PromptEvent): PromptTransition {
  switch (event.type) {
    case "requested": {
      const joined = state.items.find((item) => item.key === event.request.key && item.kind === event.request.kind)

      if (joined) return { state, id: joined.id, ended: [] }
      // SAFETY: `request` is one member of the union without its id; adding the id gives back that member.
      const item = { ...event.request, id: state.next } as Waiting

      return { state: { next: state.next + 1, items: [...state.items, item] }, id: item.id, ended: [] }
    }

    case "settled":
      if (!state.items.some((item) => item.id === event.id)) return { state, ended: [] }

      return { state: { ...state, items: state.items.filter((item) => item.id !== event.id) }, ended: [] }
    case "cleared": {
      const kinds = event.kinds
      const ended = state.items.filter((item) => !kinds || kinds.includes(item.kind))

      if (!ended.length) return { state, ended: [] }

      return {
        state: { ...state, items: state.items.filter((item) => !ended.includes(item)) },
        ended: ended.map((item) => item.id),
      }
    }
  }
}

/** The item the pane shows: a sign-in or "Leave site?" first, as they block the page, then the oldest. */
export function selectPrompt(state: PromptState) {
  return state.items.find((item) => item.kind === "auth" || item.kind === "leave") ?? state.items[0]
}

export function selectPrompted(state: PromptState, id: number) {
  return state.items.find((item) => item.id === id)
}

/** The longest host the pane names; a longer one keeps its end, where the site's own domain is. */
const HOST_MAX = 64

/**
 * The host of a URL or origin as every prompt and list of the pane names it: ASCII, so an international name shows as
 * punycode, and at most HOST_MAX characters, keeping the end, where the registrable domain is. Show it whole and let
 * it wrap; never truncate it with CSS, which would hide that end.
 */
export function promptHost(url: string) {
  if (!URL.canParse(url)) return ""
  const host = new URL(url).host

  return host.length > HOST_MAX ? `…${host.slice(1 - HOST_MAX)}` : host
}

/**
 * Who asks: the asking document's origin, from the live frame when it is known (`frame`), else from its
 * address, whose origin a `blob:` URL carries. A web origin is named by its host (`promptHost`); a local file as a
 * file; an opaque origin, as `data:` and sandboxed documents have, by no name. `embedded` is any document but the tab's
 * page: a subframe when the live frame is known, else another origin, or for an opaque origin another address, so it\n * never speaks as the page.
 */
export function promptSite(url: string, top: string, frame?: { readonly origin: string; readonly main: boolean }) {
  const origin = frame ? (frame.origin === "null" ? "null" : originOf(frame.origin)) : originOf(url)
  const embedded = frame ? !frame.main : origin === "null" ? url !== top : origin !== originOf(top)
  const protocol = URL.canParse(url) ? new URL(url).protocol : ""

  // A local preview is its workspace file to the user, wherever Chromium serves it from.
  if (origin.startsWith(`${previewScheme}:`) || (origin === "null" && (protocol === "file:" || protocol === `${previewScheme}:`)))
    return { kind: "file" as const, host: "", embedded }

  if (origin === "null" || !/^https?:$/.test(new URL(origin).protocol)) return { kind: "page" as const, host: "", embedded }

  return { kind: "web" as const, host: promptHost(origin), embedded }
}
/** Page-supplied text the pane shows as text: bounded, without controls that reorder or hide what follows. */
export function promptText(text: string, max: number) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").slice(0, max)
}
