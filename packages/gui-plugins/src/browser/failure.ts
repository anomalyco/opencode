// What the person sees when something in the pane fails. A page that did not load is explained where the page would
// be, as a browser does. A command that failed says what the person tried. Nothing here returns the app's generic
// "Request failed": a code this file does not know gets a sentence from what was being attempted, and is reported
// as unknown so the model logs it.
import type { Browser } from "@opencode/plugin-browser/rpc"
import { FileVerificationError } from "@opencode/util/file-verification"
import type { RefusalNotice } from "./ipc"

/**
 * Why a page did not load, as far as a person can act on it.
 * - `unreachable`: the address is wrong or the site is down.
 * - `offline`: this computer has no connection.
 * - `slow`: the site took too long.
 * - `insecure`: the site's certificate or encryption did not check out.
 * - `redirects`: the site kept redirecting.
 * - `blocked`: the app's rules or an extension stopped the load.
 * - `crashed`: the page's process ended.
 * - `unavailable`: a file, preview or saved address the session can no longer show.
 * - `generic`: anything else.
 */
export type LoadKind =
  | "unreachable"
  | "offline"
  | "slow"
  | "insecure"
  | "redirects"
  | "blocked"
  | "crashed"
  | "unavailable"
  | "generic"

const CHROMIUM_CODE = /\bERR_[A-Z\d_]+\b/

const LOAD_COPY = {
  unreachable: { title: "failed.unreachable.title", description: "failed.unreachable.description" },
  offline: { title: "failed.offline.title", description: "failed.offline.description" },
  slow: { title: "failed.slow.title", description: "failed.slow.description" },
  insecure: { title: "failed.insecure.title", description: "failed.insecure.description" },
  redirects: { title: "failed.redirects.title", description: "failed.redirects.description" },
  blocked: { title: "failed.blocked.title", description: "failed.blocked.description" },
  crashed: { title: "failed.crashed.title", description: "failed.crashed.description" },
  generic: { title: "failed.generic.title", description: "failed.generic.description" },
} as const

// The first rule that matches Chromium's code decides, so the narrow timeouts come before the connection family.
const CHROMIUM_KINDS: readonly (readonly [RegExp, keyof typeof LOAD_COPY])[] = [
  [/^ERR_(?:CERT_|SSL_|INSECURE_RESPONSE|BAD_SSL_)/, "insecure"],
  [/^ERR_(?:TIMED_OUT|CONNECTION_TIMED_OUT|DNS_TIMED_OUT)$/, "slow"],
  [/^ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NETWORK_ACCESS_DENIED|PROXY_CONNECTION_FAILED)$/, "offline"],
  [/^ERR_TOO_MANY_REDIRECTS$/, "redirects"],
  [/^ERR_(?:BLOCKED_BY_|UNSAFE_|DISALLOWED_URL_SCHEME|UNKNOWN_URL_SCHEME|ACCESS_DENIED)/, "blocked"],
  [/^ERR_(?:NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_|ADDRESS_|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_|INVALID_URL)/, "unreachable"],
]

/**
 * The error page for a tab's `loadError`: a plain title, one sentence of what to do, whether loading again can help,
 * and Chromium's own code for developers, which is never the headline.
 */
export function loadFailure(error: string) {
  if (error === "browser.restore.outside")
    return { kind: "unavailable", title: "failed.unavailable.title", description: "restore.outside", reload: false, code: undefined } as const

  if (error === "browser.restore.refused")
    return { kind: "unavailable", title: "failed.unavailable.title", description: "restore.refused", reload: false, code: undefined } as const

  if (error === "browser.artifact.missing")
    return { kind: "unavailable", title: "failed.unavailable.title", description: "artifact.missing", reload: true, code: undefined } as const

  if (error === FileVerificationError.code)
    return { kind: "unavailable", title: "failed.unavailable.title", description: "preview.verificationUnavailable", reload: true, code: undefined } as const

  if (error === "browser.preview.unsupported")
    return { kind: "unavailable", title: "failed.unavailable.title", description: "preview.upgrade", reload: true, code: undefined } as const

  if (error === "page_crashed") return { kind: "crashed", ...LOAD_COPY.crashed, reload: true, code: undefined } as const
  // An HTTP status, as the proxy's 502 for a target it cannot reach. A site can answer with the same number, and
  // whatever follows it would be the site's own words: the page says what it says for any load, with the number alone.
  const status = /^\d{3}\b/.exec(error)?.[0]

  if (status) return { kind: "generic", ...LOAD_COPY.generic, reload: true, code: status } as const
  // Only Chromium's own network error for the load chooses among the pages.
  const code = CHROMIUM_CODE.exec(error)?.[0]
  const kind = code ? (CHROMIUM_KINDS.find((rule) => rule[0].test(code))?.[1] ?? "generic") : "generic"

  return { kind, ...LOAD_COPY[kind], reload: true, code }
}

export type LoadFailure = ReturnType<typeof loadFailure>

/** The sentence for an address or file the pane refused to open. */
export function refusalText(
  reason: Exclude<RefusalNotice["reason"], "external" | "popup" | "browser.passkey" | "browser.passkey.agent" | "browser.passkey.off">,
) {
  if (reason === "browser.address.credentials") return "refused.credentials"

  if (reason === "browser.address.workspace") return "refused.workspace"

  if (reason === "browser.preview.restricted") return "preview.restricted"

  if (reason === "browser.preview.agentRestricted") return "preview.agentRestricted"

  return "refused.web"
}

/**
 * What a failed command or an error main reported tells the person.
 * - `none`: nothing in the notice bar. The page area already explains it (a load that failed, a page that crashed),
 *   or the model shows it elsewhere.
 * - `notice`: a line above the page. `lasting` is a refusal with a reason, which stays until the person dismisses it
 *   or does something else; anything else goes by itself. `retry` offers the same command again. `known` is false for
 *   a code this table has no sentence for, which gets one from the attempted action.
 */
export function commandFailure(code: string, action: Browser.Action["type"] | undefined) {
  if (code === "browser.address.web") return notice("refused.web", { lasting: true })

  if (code === "browser.address.credentials") return notice("refused.credentials", { lasting: true })

  if (code === "browser.address.workspace") return notice("refused.workspace", { lasting: true })

  if (code === "browser.preview.restricted") return notice("preview.restricted", { lasting: true })

  if (code === "browser.preview.agentRestricted") return notice("preview.agentRestricted", { lasting: true })

  if (code === "browser.pane.replaced") return notice("replaced", { lasting: true })

  if (code === "browser.menu.failed") return notice("menu.actionFailed", {})

  if (code === "download_failed") return notice("download.failed", {})

  // The model shows these two as a toast, which is in sight even when the pane is not.
  if (code === "browser.artifact.missing" || code === FileVerificationError.code) return { surface: "none", known: true } as const

  // The tab carries these as its `loadError`, which the page area explains.
  if (code === "page_crashed" || CHROMIUM_CODE.test(code)) return { surface: "none", known: true } as const

  // How a binding ends in the normal course. The machine takes each as a step of the attachment (suspended, registered
  // again, blocked), and none is a failure to tell the person about.
  if (
    code === "browser.pane.suspended" ||
    code === "browser.pane.registration.closed" ||
    code === "browser.pane.unsupported" ||
    code === "browser.pane.missing"
  )
    return { surface: "none", known: true } as const

  if (code === "browser.pane.unavailable") return notice(attempted(action), { retry: retriable(action) })

  return notice(attempted(action), { retry: retriable(action), known: false })
}

export type CommandFailure = ReturnType<typeof commandFailure>

function notice<Text extends string>(text: Text, options: { lasting?: boolean; retry?: boolean; known?: boolean }) {
  return { surface: "notice", text, lasting: options.lasting ?? false, retry: options.retry ?? false, known: options.known ?? true } as const
}

/** The sentence for a command that did not work, by what the person tried. */
function attempted(action: Browser.Action["type"] | undefined) {
  if (action === "navigate") return "failed.command.open"

  if (action === "tabs.open") return "failed.command.newTab"

  if (action === "reload") return "failed.command.reload"

  if (action === "back") return "failed.command.back"

  if (action === "forward") return "failed.command.forward"

  if (action === "stop") return "failed.command.stop"

  if (action === "tabs.close") return "failed.command.close"

  if (action === "tabs.focus") return "failed.command.focus"

  return "failed.command.other"
}

// Stopping, closing and switching are not worth a button: the person presses the same control again.
function retriable(action: Browser.Action["type"] | undefined) {
  return action === "navigate" || action === "tabs.open" || action === "reload" || action === "back" || action === "forward"
}
