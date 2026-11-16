import { destinationOrigin, type Policy } from "./policy"

const apps: readonly string[] = ["mailto", "tel", "sms", "facetime", "vscode", "vscode-insiders", "cursor", "zed", "slack", "msteams", "zoommtg", "zoomus", "discord", "spotify", "figma", "linear", "notion", "obsidian", "tg", "whatsapp", "x-github-client", "github-windows", "github-mac", "jetbrains"]

const denied: readonly string[] = ["http", "https", "file", "javascript", "data", "vbscript", "chrome", "chrome-extension", "oc", "oc-preview", "workspace", "about", "blob", "filesystem", "shell", "ms-msdt", "search-ms", "ms-officecmd"]

/** Validates the ORIGINAL target; never trim away a bad character or accept a parser-repaired scheme. */
export function externalTarget(value: string) {
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

  return apps.includes(scheme) ? "open" : "copy"
}

/** Chromium consumes the activation on the first popup. Match its one-shot CDP event to the native request. */
export function popupActivated(report: { url: string; userGesture: boolean } | undefined, url: string) {
  return !!report?.userGesture && report.url === url
}

/** A refused Chromium navigation is an absolute destination, never text to turn into a web search or host name. */
export function navigationNotice(url: string, policy: Policy, owner: "agent" | "user" = "user") {
  if (URL.canParse(url) && /^https?:$/i.test(new URL(url).protocol) && !destinationOrigin(url))
    return { reason: "browser.address.credentials" } as const

  const action = externalTarget(url)

  if (action) return { reason: "external", target: url, action: owner === "agent" ? "copy" : action } as const

  return { reason: policy.fileRoots?.length || policy.remote ? "browser.address.workspace" : "browser.address.web" } as const
}
