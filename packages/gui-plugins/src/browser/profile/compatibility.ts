import { Schema } from "effect"
import type { Manifest } from "./extensions"
import type { ExtensionCompatibility, ExtensionFeature } from "./ipc"

/**
 * Permissions whose API works in this browser: Electron 44's own (Chromium 152), and the ones the profile adds in
 * `extension-api`: tabs and windows over the pane, toolbar popups, right-click menus, page navigation events, cookies
 * and notifications. Checked with a probe extension and with real store extensions.
 */
const SUPPORTED = new Set([
  "activeTab",
  "alarms",
  "background",
  "clipboardRead",
  "clipboardWrite",
  "contextMenus",
  "cookies",
  "declarativeNetRequest",
  "declarativeNetRequestFeedback",
  "declarativeNetRequestWithHostAccess",
  "idle",
  "management",
  "notifications",
  "offscreen",
  "power",
  "proxy",
  "scripting",
  "storage",
  "system.display",
  "tabs",
  "unlimitedStorage",
  "webNavigation",
  "webRequestBlocking",
])

/**
 * Permissions whose API is missing here, or answers that there is nothing, by what the user would notice. A service
 * worker's `chrome.webRequest` listeners hear no request in Electron 44; a background page's do.
 */
const MISSING = new Map<string, ExtensionFeature>([
  ["webRequest", "network"],
  ["webRequestAuthProvider", "network"],
  ["nativeMessaging", "native"],
  ["identity", "signin"],
  ["identity.email", "signin"],
  ["sidePanel", "sidePanel"],
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
 * Missing APIs with events that the profile does not stand in for either. A background script registers its
 * listeners when it starts, as Manifest V3 requires, so reading one of these throws there and stops the script: a
 * service worker then never registers. Seen with Bitwarden and Vimium before `webNavigation` was added.
 */
const STARTUP = new Set(["readingList", "tabGroups", "gcm", "declarativeContent", "debugger", "ttsEngine"])

// Most noticeable first.
const ORDER: readonly ExtensionFeature[] = [
  "native",
  "shortcuts",
  "sidePanel",
  "devtools",
  "signin",
  "network",
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

  const declared = [
    ...[...required, ...optional].map((permission) => permissionFeature(permission, manifest.manifest_version)),
    manifest.commands === undefined ? undefined : "shortcuts",
    manifest.devtools_page === undefined ? undefined : "devtools",
    manifest.side_panel === undefined ? undefined : "sidePanel",
    manifest.omnibox === undefined ? undefined : "addressBar",
    manifest.oauth2 === undefined ? undefined : "signin",
    manifest.chrome_url_overrides === undefined ? undefined : "newTab",
    manifest.chrome_settings_overrides === undefined ? undefined : "settings",
    // `chrome.permissions` grants nothing it may ask for later.
    optional.length > 0 || (manifest.optional_host_permissions?.length ?? 0) > 0 ? "access" : undefined,
  ]

  const missing = ORDER.filter((feature) => declared.includes(feature))
  const cause = unsupportedCause(manifest, required)

  if (cause) return { level: "unsupported", cause, missing }

  return { level: missing.length > 0 ? "partial" : "supported", missing }
}

/** Why an extension will not do its job here; only what it requires counts, not what it may ask for later. */
function unsupportedCause(manifest: Manifest, required: readonly string[]) {
  return manifest.background !== undefined && required.some((permission) => STARTUP.has(permission))
    ? "startup"
    : undefined
}

/** A missing permission's feature; undefined for one that works here or a host pattern. */
function permissionFeature(permission: string, manifestVersion: number): ExtensionFeature | undefined {
  if (SUPPORTED.has(permission) || permission === "<all_urls>" || permission.includes("://")) return undefined
  const feature = MISSING.get(permission) ?? "other"

  // A Manifest V2 background page hears `chrome.webRequest`.
  return feature === "network" && manifestVersion === 2 ? undefined : feature
}
