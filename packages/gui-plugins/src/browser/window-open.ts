import { popupActivated } from "./refusal-notice"

/**
 * How long the person's press stands for the link it opens: the lifetime of Chromium's transient user activation
 * (`kActivationLifespan` in third_party/blink/public/common/frame/user_activation_state.h). The request a press causes
 * follows it at once; this only bounds a press that caused none.
 */
export const ACTIVATION_LIFESPAN_MS = 5_000

/**
 * The person's own latest input in the page, when it is one that can open a link elsewhere: a press of the left or
 * middle button, or Enter. Electron reports a key's modifiers but not a mouse press's, so only Enter knows where
 * Chromium opens its link (`clickDisposition`).
 */
export type Press =
  | { readonly type: "mouse"; readonly button: "left" | "middle"; readonly at: number }
  | { readonly type: "key"; readonly disposition: ReturnType<typeof clickDisposition>; readonly at: number }

/**
 * Where Chromium opens a link for the button and modifiers of a click, or of Enter on the link
 * (`DispositionFromClick` in ui/base/window_open_disposition_utils.cc). Undefined: in the same tab, or not at all.
 */
export function clickDisposition(
  input: { readonly middle: boolean; readonly control: boolean; readonly meta: boolean; readonly shift: boolean },
  mac: boolean,
) {
  if (input.middle || (mac ? input.meta : input.control)) return input.shift ? "foreground-tab" : "background-tab"

  return input.shift ? "new-window" : undefined
}

export type WindowOpening =
  /** An artifact opens no tab by itself: its link is offered in a notice, as a click on it is. */
  | { readonly type: "ask" }
  /** No tab shows the target, such as another app's link: answered as a click on that link is. */
  | { readonly type: "refuse" }
  /** No user gesture stands behind the request: "Pop-up blocked". */
  | { readonly type: "block" }
  /** A new tab, behind the current one (`background`) or in front of it. */
  | { readonly type: "open"; readonly background: boolean }

type Request = {
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
  /** Chromium's report of a `window.open` or `target="_blank"` request (`Page.windowOpen`), with its user gesture. */
  readonly report: { readonly url: string; readonly userGesture: boolean } | undefined
  /**
   * Chromium's report that a clicked link's navigation goes to a new tab or window (`Page.frameRequestedNavigation`
   * with reason `anchorClick`). `window.open` never has one.
   */
  readonly link: { readonly url: string } | undefined
  /** The link Chromium reports under the pointer (`update-target-url`), or empty. */
  readonly hovered: string
  /** Whose the tab's latest input is (`activityOwner` in policy.ts). */
  readonly owner: "agent" | "user"
  /** The person's latest input, unless a request already used it. */
  readonly press: Press | undefined
  /** Now, on the clock of `press.at`. */
  readonly at: number
}

/**
 * What a page's request for a new tab or window gets (`setWindowOpenHandler` in chromium.ts), as Chrome decides it:
 * a request without a user gesture is a blocked pop-up (`ShouldBlockPopup` in components/blocked_content), and one
 * with a gesture opens where the click's button and modifiers say.
 *
 * Chromium reports that gesture for `window.open` and a `target="_blank"` link (`report`), always before the request:
 * such a request is decided by its report alone. A link Chromium routes to a new tab by the click itself (a
 * middle-click, Ctrl+click or Shift+click; Cmd on macOS) has no such report, and opens only as the person's own link
 * press (`linkPressed`). The agent's input is never the person's, so a link the agent opens this way stays a blocked
 * pop-up.
 */
export function windowOpening(request: Request): WindowOpening {
  if (request.artifact) return { type: "ask" }

  if (!request.openable) return { type: "refuse" }

  if (!(request.report ? popupActivated(request.report, request.url) : linkPressed(request))) return { type: "block" }

  // The pane has no windows: what Chrome opens in a new window is a tab in front here.
  return { type: "open", background: request.disposition === "background-tab" }
}

/**
 * Whether a request with no `window.open` report is the link the person just pressed. Every part is Chromium's own
 * word, and a part that is missing or late only blocks:
 * - the request is a clicked link's navigation (`link`), which `window.open` cannot be;
 * - the tab is the person's, and their latest input is a fresh press that no request has used;
 * - the disposition is the press's. For Enter it is known from the key's modifiers. For a mouse press,
 *   `background-tab` is one Chromium gives only while it handles a real press with the middle button or Ctrl (Cmd on
 *   macOS), so no click a page makes up gets it. A page can make up a click that asks for a tab in front or a new
 *   window, so those two open only the link under the person's pointer (`hovered`).
 */
function linkPressed(request: Request) {
  const press = request.press

  if (request.owner !== "user" || !press || request.at - press.at > ACTIVATION_LIFESPAN_MS) return false

  if (request.link?.url !== request.url) return false

  if (press.type === "key") return press.disposition === request.disposition

  if (request.disposition === "background-tab") return true

  // The middle button never asks for a new window.
  const front = request.disposition === "foreground-tab" || (request.disposition === "new-window" && press.button === "left")

  return front && request.hovered === request.url
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
