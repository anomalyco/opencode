import { destinationOrigin, type Policy } from "./policy"

const apps: readonly string[] = ["mailto", "tel", "sms", "facetime", "slack", "msteams", "zoommtg", "zoomus", "discord", "spotify", "figma", "linear", "notion", "obsidian", "tg", "whatsapp", "x-github-client", "github-windows", "github-mac"]

// Editors can act on a project or remote host, not just show a document. A conversation can offer to copy these.
const pageOnly: readonly string[] = ["vscode", "vscode-insiders", "cursor", "zed", "jetbrains"]

const denied: readonly string[] = ["http", "https", "file", "javascript", "data", "vbscript", "chrome", "chrome-extension", "oc", "oc-preview", "workspace", "about", "blob", "filesystem", "shell", "ms-msdt", "search-ms", "ms-officecmd"]

/** Validates the ORIGINAL target; never trim away a bad character or accept a parser-repaired scheme. */
export function externalTarget(value: string, source: "conversation" | "page" = "page") {
  if (
    value.length > 2048 ||
    /[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]|%(?:0\d|0[a-f]|1[\da-f]|7f)/iu.test(value) ||
    value.trim() !== value
  )
    return
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1].toLowerCase()

  if (!scheme || denied.includes(scheme) || scheme.startsWith("opencode") || !URL.canParse(value)) return
  const parsed = new URL(value)

  if (parsed.username || parsed.password) return

  if (source === "conversation") {
    if (scheme === "obsidian" && !/^\/\/(?:open|search)(?:\?|$)/.test(value.slice(scheme.length + 1))) return "copy"

    if (scheme === "mailto" && Array.from(parsed.searchParams.keys()).some(key => /^(?:attach|attachment)$/i.test(key))) return "copy"
  }

  // A 320px pane gives the URL its own 296px row: at least 40 default mono glyphs per line, for five lines.
  // The bar also checks the actual font and available width before presenting Open.
  const permitted = apps.includes(scheme) || (source === "page" && pageOnly.includes(scheme))

  return permitted && /^[\x21-\x7e]{1,200}$/.test(value) ? "open" : "copy"
}

/** Chromium consumes the activation on the first popup. Match its one-shot CDP event to the native request. */
export function popupActivated(report: { url: string; userGesture: boolean } | undefined, url: string) {
  return !!report?.userGesture && report.url === url
}

/** A refused Chromium navigation is an absolute destination, never text to turn into a web search or host name. */
export function navigationNotice(url: string, policy: Policy, owner: "agent" | "user" | "conversation" = "user", documentInput = false) {
  if (URL.canParse(url) && /^https?:$/i.test(new URL(url).protocol) && !destinationOrigin(url))
    return { reason: "browser.address.credentials" } as const

  const source = owner === "conversation" ? "conversation" : "page"
  const action = externalTarget(url, source)

  if (action) {
    const unattendedEditor = !documentInput && pageOnly.includes(url.slice(0, url.indexOf(":")).toLowerCase())

    return { reason: "external", target: url, source, action: owner === "agent" || unattendedEditor ? "copy" : action } as const
  }

  const reason = policy.fileRoots?.length || policy.remote ? "browser.address.workspace" : "browser.address.web"

  return owner === "conversation" ? { reason, source: "conversation" } as const : { reason } as const
}
