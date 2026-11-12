import { Schema } from "effect"
import type { Manifest } from "./extensions"
import type { ExtensionCompatibility, ExtensionFeature } from "./ipc"

/**
 * Permissions whose API works in this browser: Electron's extension support, as a probe extension and real store
 * extensions found it in Electron 44 (Chromium 152). `tabs` lacks `create`, `getCurrent` and `chrome.windows`, which
 * no permission declares.
 */
const SUPPORTED = new Set([
  "activeTab",
  "alarms",
  "background",
  "clipboardRead",
  "clipboardWrite",
  "idle",
  "management",
  "offscreen",
  "power",
  "proxy",
  "scripting",
  "storage",
  "system.display",
  "tabs",
  "unlimitedStorage",
])

/**
 * Permissions whose API is missing here, or does nothing, by what the user would notice. The profile's own
 * `session.webRequest` guard for `file:` pages takes every request away from extensions, so neither `webRequest`
 * nor `declarativeNetRequest` sees one, although Electron supports both.
 */
const MISSING = new Map<string, ExtensionFeature>([
  ["webRequestBlocking", "blocking"],
  ["declarativeNetRequest", "blocking"],
  ["declarativeNetRequestWithHostAccess", "blocking"],
  ["declarativeNetRequestFeedback", "blocking"],
  ["webRequest", "network"],
  ["webRequestAuthProvider", "network"],
  ["contextMenus", "menus"],
  ["menus", "menus"],
  ["nativeMessaging", "native"],
  ["identity", "signin"],
  ["identity.email", "signin"],
  ["sidePanel", "sidePanel"],
  ["notifications", "notifications"],
  ["webNavigation", "navigation"],
  ["cookies", "cookies"],
  ["history", "browserData"],
  ["bookmarks", "browserData"],
  ["sessions", "browserData"],
  ["topSites", "browserData"],
  ["readingList", "browserData"],
  ["tabGroups", "browserData"],
  ["favicon", "browserData"],
  ["downloads", "browserData"],
  ["downloads.open", "browserData"],
  ["downloads.ui", "browserData"],
  ["privacy", "settings"],
  ["fontSettings", "settings"],
  ["contentSettings", "settings"],
  ["browsingData", "settings"],
  ["userScripts", "userScripts"],
])

/**
 * Missing APIs with events. A background script registers its listeners when it starts, as Manifest V3 requires,
 * so reading one of these throws there and stops the script: a service worker then never registers. Seen with
 * Bitwarden and Vimium (`webNavigation`) and 1Password (`contextMenus`).
 */
const STARTUP = new Set([
  "contextMenus",
  "menus",
  "webNavigation",
  "notifications",
  "cookies",
  "history",
  "bookmarks",
  "sessions",
  "readingList",
  "tabGroups",
  "downloads",
  "identity",
  "sidePanel",
])

// Most noticeable first.
const ORDER: readonly ExtensionFeature[] = [
  "blocking",
  "native",
  "popup",
  "toolbar",
  "menus",
  "shortcuts",
  "sidePanel",
  "devtools",
  "signin",
  "notifications",
  "network",
  "navigation",
  "cookies",
  "browserData",
  "settings",
  "addressBar",
  "newTab",
  "access",
  "userScripts",
  "other",
]

/** Whether an extension works in this browser, from the permissions and keys its manifest declares. */
export function extensionCompatibility(manifest: Manifest): ExtensionCompatibility {
  const required = (manifest.permissions ?? []).filter(Schema.is(Schema.String))
  const optional = (manifest.optional_permissions ?? []).filter(Schema.is(Schema.String))
  const action = manifest.action ?? manifest.browser_action ?? manifest.page_action

  const declared = [
    ...[...required, ...optional].map(permissionFeature),
    action ? (action.default_popup ? "popup" : "toolbar") : undefined,
    manifest.commands === undefined ? undefined : "shortcuts",
    manifest.devtools_page === undefined ? undefined : "devtools",
    manifest.side_panel === undefined ? undefined : "sidePanel",
    manifest.omnibox === undefined ? undefined : "addressBar",
    manifest.oauth2 === undefined ? undefined : "signin",
    manifest.chrome_url_overrides === undefined ? undefined : "newTab",
    manifest.chrome_settings_overrides === undefined ? undefined : "settings",
    manifest.declarative_net_request === undefined ? undefined : "blocking",
    // `chrome.permissions`, which asks for them, is missing.
    optional.length > 0 || (manifest.optional_host_permissions?.length ?? 0) > 0 ? "access" : undefined,
  ]

  const missing = ORDER.filter((feature) => declared.includes(feature))
  const cause = unsupportedCause(manifest, required)

  if (cause) return { level: "unsupported", cause, missing }

  return { level: missing.length > 0 ? "partial" : "supported", missing }
}

/** Why an extension will not do its job here; only what it requires counts, not what it may ask for later. */
function unsupportedCause(manifest: Manifest, required: readonly string[]) {
  // Manifest V2 has no `chrome.browserAction` or `chrome.pageAction` here; uBlock Origin's background stops at it.
  const legacyAction = manifest.manifest_version === 2 && (!!manifest.browser_action || !!manifest.page_action)
  const stops = legacyAction || required.some((permission) => STARTUP.has(permission))

  if (manifest.background !== undefined && stops) return "startup"

  if (manifest.declarative_net_request !== undefined || required.some((item) => MISSING.get(item) === "blocking"))
    return "blocking"

  if (required.includes("nativeMessaging")) return "native"

  return undefined
}

/** A missing permission's feature; undefined for one that works here or a host pattern. */
function permissionFeature(permission: string): ExtensionFeature | undefined {
  if (SUPPORTED.has(permission) || permission === "<all_urls>" || permission.includes("://")) return undefined

  return MISSING.get(permission) ?? "other"
}
