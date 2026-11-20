import { popupActivated } from "./refusal-notice"

/**
 * How long the person's press or key lets its page open a tab: the lifetime of Chromium's transient user activation
 * (`kActivationLifespan` in third_party/blink/public/common/frame/user_activation_state.h).
 */
export const ACTIVATION_LIFESPAN_MS = 5_000

export type WindowOpening =
  /** An artifact opens no tab by itself: its link is offered in a notice, as a click on it is. */
  | { readonly type: "ask" }
  /** No tab shows the target, such as another app's link: answered as a click on that link is. */
  | { readonly type: "refuse" }
  /** No user gesture stands behind the request: "Pop-up blocked". */
  | { readonly type: "block" }
  /** A new tab, behind the current one (`background`) or in front of it. */
  | { readonly type: "open"; readonly background: boolean }

/**
 * What a page's request for a new tab or window gets (`setWindowOpenHandler` in chromium.ts), as Chrome decides it:
 * a request without a user gesture is a blocked pop-up (`ShouldBlockPopup` in components/blocked_content), and one
 * with a gesture opens where the click's button and modifiers say (`DispositionFromClick` in
 * ui/base/window_open_disposition_utils.cc).
 *
 * Chromium reports that gesture for `window.open` and a `target="_blank"` link (`report`). It reports none for a link
 * it routes to a new tab by the click itself: a middle-click, Ctrl+click (Cmd on macOS) or Shift+click. That link's
 * gesture is the person's own press or key in the page (`pressedAt`), while the tab is theirs (`owner`). The agent's
 * input is never the person's, so a link the agent opens this way stays a blocked pop-up.
 */
export function windowOpening(request: {
  /** The page is an artifact, which opens no pop-up and leaves through no link. */
  readonly artifact: boolean
  /** A tab can show the target: `about:blank`, a web address, a resource of the page's extension, or a preview. */
  readonly openable: boolean
  readonly url: string
  /**
   * Chromium's disposition of the request. `background-tab`: a middle-click or Ctrl+click (Cmd on macOS).
   * `foreground-tab`: the same with Shift, a `target="_blank"` link, or `window.open`. `new-window`: a Shift+click, or
   * `window.open` with features. Any other value opens in front too.
   */
  readonly disposition: string
  /** Chromium's report of a `window.open` or `target="_blank"` request; absent for a link routed by its click. */
  readonly report: { readonly url: string; readonly userGesture: boolean } | undefined
  /** Whose the tab's latest input is (`activityOwner` in policy.ts). */
  readonly owner: "agent" | "user"
  /** When the person last pressed a button or key in this document, unless a tab already opened for that press. */
  readonly pressedAt: number | undefined
  /** Now, on the clock of `pressedAt`. */
  readonly at: number
}): WindowOpening {
  if (request.artifact) return { type: "ask" }

  if (!request.openable) return { type: "refuse" }

  const activated = request.report
    ? popupActivated(request.report, request.url)
    : request.owner === "user" &&
      request.pressedAt !== undefined &&
      request.at - request.pressedAt <= ACTIVATION_LIFESPAN_MS

  if (!activated) return { type: "block" }

  // The pane has no windows: what Chrome opens in a new window is a tab in front here.
  return { type: "open", background: request.disposition === "background-tab" }
}

/** Where the first navigation of a tab ended, when it left the tab no document to show. */
export type Unshown =
  /** A download the person is still placing in the save dialog. */
  | "download.choosing"
  /** A download that has its place, or that ended. */
  | "download"
  /** Another app's link, which the pane offers to open. */
  | "app"
  /** An address the pane refuses, which the tab says in its own notice. */
  | "refused"

/**
 * Whether a tab closes itself because its first navigation left it nothing to show, as Chrome closes a new tab whose
 * navigation became a download (`DownloadUIController::OnDownloadUpdated` in chrome/browser/download) or went to
 * another app (`LaunchUrlWithoutSecurityCheckWithDelegate` in chrome/browser/external_protocol). Only a tab a page
 * opened (`opened`) that has shown no document (`committed`) does, so nothing the person saw goes with it. Chrome waits
 * until the download has its place. The agent's tabs keep their downloads, so they stay.
 */
export function closesUnshown(
  tab: { readonly opened: boolean; readonly committed: boolean; readonly owner: "agent" | "user" },
  outcome: Unshown,
) {
  return tab.opened && !tab.committed && tab.owner === "user" && (outcome === "download" || outcome === "app")
}
