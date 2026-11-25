// What a tab waits on the user for, besides a page dialog (the dialog gate owns those): a site's permission request,
// a site's sign-in, the page asking before the user leaves it, and the system refusing a device the user allowed.
// Oldest first; the pane shows one at a time with a count of the rest. A request with the key of one that waits joins
// it instead of queueing again. Every item ends with an answer: the user's, its deadline, or a navigation or close
// that clears it, each settled exactly once.
import type { Browser } from "@opencode/plugin-browser/rpc"
import { displayHost } from "./host-display"
import { previewScheme } from "./scheme"
import { originOf, type PermissionKind } from "./site-permissions"

export type Waiting =
  | {
      readonly kind: "permission"
      readonly id: number
      readonly key: string
      readonly origin: string
      readonly permissions: readonly PermissionKind[]
      /** How long the user may keep the decision: in the profile, for a remote server's run, or not at all. */
      readonly remember: "kept" | "session" | "none"
      /** The agent drives the tab: the answer is for this request only. */
      readonly agent: boolean
      /** macOS has not asked about a device yet: it asks after the user allows the site. */
      readonly system: boolean
    }
  | {
      readonly kind: "auth"
      readonly id: number
      readonly key: string
      /** The asking site, whose sign-in a dismissal ends for the visit. */
      readonly origin: string
      readonly host: string
      readonly realm: string
      /** The site refused the last user name and password it was given. */
      readonly failed: boolean
      /** It asks for the top-level page being opened, so it ends when that navigation stops without committing. */
      readonly navigation: boolean
    }
  | { readonly kind: "leave"; readonly id: number; readonly key: string }
  | { readonly kind: "system"; readonly id: number; readonly key: string; readonly device: "camera" | "microphone" }

/** Each item, with how many requests it holds (`asked`): a repeated request shows the same item again. */
export type Asked = Waiting & { readonly asked: number }

export type WaitingRequest = Waiting extends infer Item ? (Item extends Waiting ? Omit<Item, "id"> : never) : never

export type PromptState = { readonly next: number; readonly items: readonly Asked[] }

export type PromptEvent =
  | { readonly type: "requested"; readonly request: WaitingRequest }
  /** The user answered, or its deadline passed. */
  | { readonly type: "settled"; readonly id: number }
  /** A navigation or close ends these kinds, or every item; `navigation` limits it to the navigation's sign-ins. */
  | { readonly type: "cleared"; readonly kinds?: readonly Waiting["kind"][]; readonly navigation?: boolean }

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

      // A repeat shows the same item again, which the pane treats as new: its input protection starts over.
      if (joined)
        return {
          state: { ...state, items: state.items.map((item) => (item === joined ? { ...item, asked: item.asked + 1 } : item)) },
          id: joined.id,
          ended: [],
        }
      // SAFETY: `request` is one member of the union without its id; adding the id gives back that member.
      const item = { ...event.request, id: state.next, asked: 1 } as Asked

      return { state: { next: state.next + 1, items: [...state.items, item] }, id: item.id, ended: [] }
    }

    case "settled":
      if (!state.items.some((item) => item.id === event.id)) return { state, ended: [] }

      return { state: { ...state, items: state.items.filter((item) => item.id !== event.id) }, ended: [] }
    case "cleared": {
      const kinds = event.kinds

      const ended = state.items.filter(
        (item) => (!kinds || kinds.includes(item.kind)) && (!event.navigation || (item.kind === "auth" && item.navigation)),
      )

      if (!ended.length) return { state, ended: [] }

      return {
        state: { ...state, items: state.items.filter((item) => !ended.includes(item)) },
        ended: ended.map((item) => item.id),
      }
    }
  }
}

/**
 * The item the pane shows: "Leave site?" first, as a close the page held keeps its tab only while the pane shows it,
 * then a sign-in, as it blocks the page, then the oldest.
 */
export function selectPrompt(state: PromptState) {
  return (
    state.items.find((item) => item.kind === "leave") ?? state.items.find((item) => item.kind === "auth") ?? state.items[0]
  )
}

export function selectPrompted(state: PromptState, id: number) {
  return state.items.find((item) => item.id === id)
}

/** A user navigation or close the page may hold back; "Leave" runs it again. */
export type LeaveAction = { readonly type: "close" } | Browser.Action

/**
 * How long a user's navigation stays the user's for its page's beforeunload. Chromium asks the page after the command
 * that started it may have ended: a dialog the page opens ends the command's wait.
 */
export const INTENT_MS = 10_000

/**
 * A tab's visit to one top-level origin, as its prompts need it: the top-level navigation in flight (`pending`, after
 * its redirects), the user's last navigation while the page may still ask to stay (`intent`), whether the user chose
 * Leave (`bypass`), and the sign-ins asked for (`attempts`, by `challengeKey`) and dismissed (`dismissed`, by origin).
 */
export type Visit = {
  readonly committed: string
  readonly pending?: string
  readonly intent?: { readonly action: LeaveAction; readonly at: number }
  readonly bypass: boolean
  readonly attempts: Readonly<Record<string, number>>
  readonly dismissed: readonly string[]
}

export type VisitEvent =
  /** A top-level, cross-document navigation started. */
  | { readonly type: "started"; readonly url: string }
  /** The top-level navigation in flight was redirected. */
  | { readonly type: "redirected"; readonly url: string }
  | { readonly type: "committed"; readonly origin: string }
  /** Loading stopped: a 204, a download, a failure or Stop ends a navigation that did not commit. */
  | { readonly type: "stopped" }
  /** The user started a navigation or a close. */
  | { readonly type: "intended"; readonly action: LeaveAction; readonly at: number }
  /** An agent command started, or the close probe ended: what unloads now is not the user's doing. */
  | { readonly type: "intent-ended" }
  /** The page's beforeunload asks to stay. */
  | { readonly type: "unloading"; readonly at: number }
  /** The user chose Leave: the next unload proceeds. */
  | { readonly type: "bypassed" }
  | { readonly type: "bypass-ended" }
  | { readonly type: "challenged"; readonly key: string; readonly attempt: number }
  | { readonly type: "dismissed"; readonly origin: string }

export type VisitTransition = {
  readonly state: Visit
  /** Prompts this event ends (see the `cleared` prompt event). */
  readonly clear?: { readonly kinds: readonly Waiting["kind"][]; readonly navigation?: boolean }
  /** The visit ended: decisions made for it go. */
  readonly ended?: boolean
  /** For `unloading`: the user's action to hold for "Leave site?". */
  readonly leave?: LeaveAction
  /** For `unloading`: the user chose Leave, so the page goes. */
  readonly proceed?: boolean
}

export const createVisit = (committed: string): Visit => ({ committed, bypass: false, attempts: {}, dismissed: [] })

export function transitionVisit(state: Visit, event: VisitEvent): VisitTransition {
  switch (event.type) {
    case "started": {
      const next = { ...state, pending: event.url, intent: undefined }

      // A navigation the user started asks a site they dismissed again; one the page started does not.
      return {
        state: state.intent ? { ...next, attempts: {}, dismissed: [] } : next,
        clear: { kinds: ["auth", "leave"] },
      }
    }

    case "redirected":
      return { state: state.pending === undefined ? state : { ...state, pending: event.url } }
    case "committed":
      if (event.origin !== state.committed) return { state: createVisit(event.origin), clear: { kinds: ["permission", "leave", "system", "auth"] }, ended: true }

      return { state: { ...state, pending: undefined }, clear: { kinds: ["permission", "leave", "system"] }, ended: false }
    case "stopped":
      return { state: { ...state, pending: undefined }, clear: { kinds: ["auth"], navigation: true } }
    case "intended":
      return { state: { ...state, intent: { action: event.action, at: event.at } } }
    case "intent-ended":
      return { state: state.intent ? { ...state, intent: undefined } : state }
    case "unloading": {
      if (state.bypass) return { state: { ...state, bypass: false }, proceed: true }
      const fresh = state.intent && event.at - state.intent.at <= INTENT_MS ? state.intent.action : undefined

      return { state: { ...state, intent: undefined }, leave: fresh, proceed: false }
    }

    case "bypassed":
      return { state: { ...state, bypass: true } }
    case "bypass-ended":
      return { state: { ...state, bypass: false } }
    case "challenged":
      return { state: { ...state, attempts: { ...state.attempts, [event.key]: event.attempt } } }
    case "dismissed":
      return {
        state: state.dismissed.includes(event.origin) ? state : { ...state, dismissed: [...state.dismissed, event.origin] },
      }
  }
}

/**
 * Who asks: the asking document's origin, from the live frame when it is known (`frame`), else from its
 * address, whose origin a `blob:` URL carries. A web origin is named by its host (`displayHost`); a local file as a
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

  return { kind: "web" as const, host: displayHost(origin), embedded }
}

/** Page-supplied text the pane shows as text: bounded, without controls that reorder or hide what follows. */
export function promptText(text: string, max: number) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").slice(0, max)
}
