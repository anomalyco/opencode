import type { BetaNotes } from "./beta-notes"
import type { Highlight } from "./whats-new"

/** Bounds the dialog's chunk and the changelog request, so a stalled connection never opens a dialog mid-session. */
export const WHATS_NEW_TIMEOUT_MS = 15_000

/** What the dialog shows: on beta the notes the build embeds, elsewhere the changelog's highlights. */
export type WhatsNewContent =
  | { readonly channel: "beta"; readonly notes: BetaNotes }
  | { readonly channel: "stable"; readonly highlights: readonly Highlight[] }

export type WhatsNewInit = {
  readonly version: string | undefined
  readonly commit: string | undefined
  readonly channel: WhatsNewContent["channel"]
  readonly previousVersion: string | undefined
  readonly previousCommit: string | undefined
  /** Release notes are on in Settings. */
  readonly enabled: boolean
}

/** What's New after an update; it only moves forward, so results match on the phase. */
export type WhatsNewState =
  /** The dialog's chunk, and on stable the changelog, load for the release `version`. */
  | {
      readonly status: "loading"
      readonly version: string
      readonly commit: string | undefined
      readonly previousVersion: string
    }
  /** Nothing more happens this start: the dialog opened, there was nothing to show, or the load failed or ended. */
  | { readonly status: "done" }

export type WhatsNewEvent =
  /** `content` is undefined, or has no highlights, when nothing since the version seen is worth showing. */
  | { readonly type: "loaded"; readonly content: WhatsNewContent | undefined }
  | { readonly type: "load.failed" }
  | { readonly type: "load.timed-out" }
  /** The user turned release notes off in Settings. */
  | { readonly type: "disabled" }
  | { readonly type: "disposed" }

export type WhatsNewEffect =
  | {
      readonly type: "load"
      readonly channel: WhatsNewContent["channel"]
      readonly previousVersion: string
      readonly previousCommit: string | undefined
      readonly version: string
      readonly timeoutMs: number
    }
  /** Ends the load's timeout and request. */
  | { readonly type: "abort-load" }
  /** Remembers the release, so the next start shows nothing. */
  | { readonly type: "mark-seen"; readonly version: string; readonly commit: string | undefined }
  | { readonly type: "open"; readonly content: WhatsNewContent; readonly previousVersion: string }

export type WhatsNewTransition = { readonly state: WhatsNewState; readonly effects: readonly WhatsNewEffect[] }

const DONE: WhatsNewState = { status: "done" }

const NONE: readonly WhatsNewEffect[] = []

/**
 * Decides at startup: an unchanged version shows nothing; the first run and disabled release notes only remember the
 * version; otherwise the channel's notes load.
 */
export function initWhatsNew(input: WhatsNewInit): WhatsNewTransition {
  const version = input.version

  if (!version || input.previousVersion === version) return { state: DONE, effects: NONE }

  if (!input.previousVersion || !input.enabled)
    return { state: DONE, effects: [{ type: "mark-seen", version, commit: input.commit }] }

  return {
    state: { status: "loading", version, commit: input.commit, previousVersion: input.previousVersion },
    effects: [
      {
        type: "load",
        channel: input.channel,
        previousVersion: input.previousVersion,
        previousCommit: input.previousCommit,
        version,
        timeoutMs: WHATS_NEW_TIMEOUT_MS,
      },
    ],
  }
}

export function transitionWhatsNew(state: WhatsNewState, event: WhatsNewEvent): WhatsNewTransition {
  if (state.status === "done") return { state, effects: NONE }

  // A failed or abandoned load leaves the release unseen, so the next start tries again.
  if (event.type === "load.failed" || event.type === "load.timed-out" || event.type === "disposed")
    return { state: DONE, effects: [{ type: "abort-load" }] }

  const seen: readonly WhatsNewEffect[] = [
    { type: "abort-load" },
    { type: "mark-seen", version: state.version, commit: state.commit },
  ]

  const content = event.type === "loaded" ? event.content : undefined

  if (!content || (content.channel === "stable" && content.highlights.length === 0))
    return { state: DONE, effects: seen }

  return {
    state: DONE,
    effects: [...seen, { type: "open", content, previousVersion: state.previousVersion }],
  }
}

/** Whether the driver still watches the setting and owns a load to end. */
export function whatsNewLoading(state: WhatsNewState) {
  return state.status === "loading"
}
