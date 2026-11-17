import type { ConfigEntry } from "@opencode/client/promise"
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
  /**
   * Not working yet. Every step runs the installer, which does whatever is left: `opencode` is browse installed but
   * missing from OpenCode's config, `browser` its extension not added or not paired.
   */
  | { readonly phase: "setup"; readonly step: BrowseSetupStep }
  | { readonly phase: "installing"; readonly store: boolean }
  /**
   * The installer gave up waiting for the extension (or failed some other way after installing browse) and the
   * extension still isn't connected. Running it again fixes most of these; the rest pair by hand.
   */
  | { readonly phase: "stalled" }
  /** The installer failed before browse was on this computer. */
  | { readonly phase: "failed"; readonly failure: BrowseInstallFailure }
  | { readonly phase: "ready" }

export type BrowseSetupStep = "install" | "opencode" | "browser" | "update"

/**
 * Whether the `browse_setup` flag is on, resolved as the server resolves flags: `experimental.browse_setup` from the
 * highest-priority document that sets `experimental`, then `all_flags: true` from the highest-priority document that sets
 * it, then on for local and dev builds. `OPENCODE_FLAGS` reaches only the server, so it doesn't apply here. Off until the
 * config has loaded, so a config that turns it off never shows the row.
 */
export function browseSetupEnabled(
  entries: readonly ConfigEntry[] | undefined,
  channel = import.meta.env.VITE_OPENCODE_CHANNEL ?? "local",
) {
  if (!entries) return false

  const experimental = entries.flatMap((entry) =>
    entry.type === "document" && entry.info.experimental ? [entry.info.experimental] : [],
  )
  const configured = experimental.at(-1)?.browse_setup

  if (configured !== undefined) return configured

  if (experimental.findLast((item) => item.all_flags !== undefined)?.all_flags === true) return true

  return channel === "local" || channel === "dev"
}

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

  if (!browse.installed && browse.job.status === "failed") return { phase: "failed", failure: browse.job.failure }

  const step = setupStep(browse)

  // An installer that fails after installing browse isn't an error to show: most often its wait for the extension ran
  // out. Other steps it left offer themselves again.
  if (step === "browser" && browse.job.status === "failed") return { phase: "stalled" }

  if (step) return { phase: "setup", step }

  return { phase: "ready" }
}

/** The row polls while the installer runs: it waits on the user to add the extension and pair it. */
export function browseCardPolling(state: BrowseCardState) {
  return browseCardView(state).phase === "installing"
}

function setupStep(browse: BrowseStatus): BrowseSetupStep | undefined {
  if (!browse.installed) return "install"

  if (!browse.configured) return "opencode"

  if (browse.extension === "incompatible") return "update"

  if (browse.extension === "not-seen" || browse.extension === "unpaired" || browse.extension === "refused")
    return "browser"
}

function unchanged(state: BrowseCardState): BrowseCardTransition {
  return { state, effects: [] }
}
