import type { BrowseInstallFailure, BrowseStatus } from "@/runtime/platform/platform"

/**
 * The browse row in Settings → Extensions. The desktop's main process owns the installer; this row reads its status,
 * starts it, and polls while it runs so the row follows the install, the Chrome Web Store step and the pairing.
 */
export type BrowseCardState =
  | { readonly status: "checking"; readonly attempt: number }
  | { readonly status: "ready"; readonly attempt: number; readonly browse: BrowseStatus }
  /** The install was requested and main hasn't confirmed it started. */
  | { readonly status: "starting"; readonly attempt: number; readonly browse: BrowseStatus }
  | { readonly status: "unavailable"; readonly attempt: number }
  | { readonly status: "disposed" }

export type BrowseCardEvent =
  | { readonly type: "refresh.requested" }
  | { readonly type: "read.succeeded"; readonly attempt: number; readonly browse: BrowseStatus }
  | { readonly type: "read.failed"; readonly attempt: number }
  | { readonly type: "install.requested" }
  | { readonly type: "install.started"; readonly attempt: number }
  | { readonly type: "install.failed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type BrowseCardEffect =
  | { readonly type: "read"; readonly attempt: number }
  | { readonly type: "install"; readonly attempt: number }
  /** The installer finished: OpenCode's config changed, so its MCP list may have too. */
  | { readonly type: "sync-mcps" }

export type BrowseCardTransition = { readonly state: BrowseCardState; readonly effects: readonly BrowseCardEffect[] }

export type BrowseCardView =
  | { readonly phase: "checking" }
  | { readonly phase: "unavailable" }
  | { readonly phase: "absent"; readonly failure?: BrowseInstallFailure }
  | { readonly phase: "installing"; readonly store: boolean }
  | {
      readonly phase: "incomplete"
      readonly reason: BrowseIncomplete
      readonly store: boolean
      readonly failure?: BrowseInstallFailure
    }
  | { readonly phase: "ready"; readonly connected: boolean }

export type BrowseIncomplete = "config" | "extension" | "pairing" | "update"

export function createBrowseCardState(): BrowseCardTransition {
  return { state: { status: "checking", attempt: 1 }, effects: [{ type: "read", attempt: 1 }] }
}

export function transitionBrowseCard(state: BrowseCardState, event: BrowseCardEvent): BrowseCardTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: { status: "disposed" }, effects: [] }

  switch (event.type) {
    case "refresh.requested": {
      if (state.status !== "ready" && state.status !== "unavailable") return unchanged(state)

      const attempt = state.attempt + 1

      return { state: { ...state, attempt }, effects: [{ type: "read", attempt }] }
    }

    case "read.succeeded": {
      if (state.status === "starting" || event.attempt !== state.attempt) return unchanged(state)

      const finished =
        state.status === "ready" && state.browse.job.status === "installing" && event.browse.job.status !== "installing"

      return {
        state: { status: "ready", attempt: state.attempt, browse: event.browse },
        effects: finished ? [{ type: "sync-mcps" }] : [],
      }
    }

    case "read.failed":
      // A failed poll keeps what the row already shows; only a first read has nothing to fall back to.
      if (state.status !== "checking" || event.attempt !== state.attempt) return unchanged(state)

      return { state: { status: "unavailable", attempt: state.attempt }, effects: [] }

    case "install.requested": {
      if (state.status !== "ready" || state.browse.job.status === "installing") return unchanged(state)

      const attempt = state.attempt + 1

      return {
        state: { status: "starting", attempt, browse: state.browse },
        effects: [{ type: "install", attempt }],
      }
    }

    case "install.started": {
      if (state.status !== "starting" || event.attempt !== state.attempt) return unchanged(state)

      const attempt = state.attempt + 1

      return {
        state: { status: "ready", attempt, browse: { ...state.browse, job: { status: "installing" } } },
        effects: [{ type: "read", attempt }],
      }
    }

    case "install.failed":
      if (state.status !== "starting" || event.attempt !== state.attempt) return unchanged(state)

      return {
        state: {
          status: "ready",
          attempt: state.attempt,
          browse: { ...state.browse, job: { status: "failed", failure: { reason: "start" } } },
        },
        effects: [],
      }
  }
}

export function browseCardView(state: BrowseCardState): BrowseCardView {
  if (state.status === "checking" || state.status === "disposed") return { phase: "checking" }

  if (state.status === "unavailable") return { phase: "unavailable" }

  if (state.status === "starting") return { phase: "installing", store: false }

  const browse = state.browse

  if (browse.job.status === "installing") return { phase: "installing", store: browse.extension === "not-seen" }

  const failure = browse.job.status === "failed" ? browse.job.failure : undefined

  if (!browse.installed) return { phase: "absent", failure }

  const reason = incomplete(browse)

  if (reason) return { phase: "incomplete", reason, store: browse.extension === "not-seen", failure }

  return { phase: "ready", connected: browse.extension === "connected" }
}

/** The row polls while the installer runs: it waits on the user to add the extension and pair it. */
export function browseCardPolling(state: BrowseCardState) {
  return browseCardView(state).phase === "installing"
}

function incomplete(browse: BrowseStatus): BrowseIncomplete | undefined {
  if (!browse.configured) return "config"

  if (browse.extension === "not-seen") return "extension"

  if (browse.extension === "unpaired" || browse.extension === "refused") return "pairing"

  if (browse.extension === "incompatible") return "update"
}

function unchanged(state: BrowseCardState): BrowseCardTransition {
  return { state, effects: [] }
}
