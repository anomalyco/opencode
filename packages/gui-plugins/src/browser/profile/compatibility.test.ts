import { expect, test } from "bun:test"
import { extensionCompatibility } from "./compatibility"
import type { Manifest } from "./extensions"

const manifest = (fields: Partial<Manifest>): Manifest => ({ manifest_version: 3, name: "x", version: "1", ...fields })

const worker = { service_worker: "background.js" }

// The declared fields of the store versions tried in the desktop app, with what each did there.
test.each([
  {
    // Formats JSON pages from its content script; nothing else to miss.
    name: "JSON Formatter",
    manifest: manifest({ permissions: ["storage"], options_ui: { page: "options.html" } }),
    expected: { level: "supported", missing: [] },
  },
  {
    // Its worker starts and pages turn dark; the popup, opened as a tab, finds no page to theme.
    name: "Dark Reader",
    manifest: manifest({
      background: worker,
      permissions: ["alarms", "fontSettings", "scripting", "storage"],
      optional_permissions: ["contextMenus"],
      commands: {},
      action: { default_popup: "ui/popup/index.html" },
    }),
    expected: { level: "partial", missing: ["popup", "menus", "shortcuts", "settings", "access"] },
  },
  {
    // Its worker reads `chrome.webNavigation` at start and never registers.
    name: "Bitwarden",
    manifest: manifest({
      background: worker,
      permissions: ["storage", "tabs", "contextMenus", "webNavigation", "webRequest", "notifications", "sidePanel"],
      optional_permissions: ["nativeMessaging", "privacy"],
      action: { default_popup: "popup/index.html" },
      side_panel: {},
      commands: {},
    }),
    expected: {
      level: "unsupported",
      cause: "startup",
      missing: [
        "native",
        "popup",
        "menus",
        "shortcuts",
        "sidePanel",
        "notifications",
        "network",
        "navigation",
        "settings",
        "access",
      ],
    },
  },
  {
    // Its static rules only block once its worker turns them on, and requests never reach them here.
    name: "uBlock Origin Lite",
    manifest: manifest({
      background: worker,
      permissions: ["activeTab", "declarativeNetRequest", "offscreen", "scripting", "storage", "userScripts"],
      declarative_net_request: {},
      action: { default_popup: "popup.html" },
      commands: {},
    }),
    expected: { level: "unsupported", cause: "blocking", missing: ["blocking", "popup", "shortcuts", "userScripts"] },
  },
  {
    // Manifest V2: its background page stops at `chrome.browserAction`.
    name: "uBlock Origin",
    manifest: manifest({
      manifest_version: 2,
      background: { page: "background.html" },
      permissions: ["storage", "tabs", "webRequest", "webRequestBlocking", "<all_urls>"],
      browser_action: { default_popup: "popup-fenix.html" },
    }),
    expected: { level: "unsupported", cause: "startup", missing: ["blocking", "popup", "network"] },
  },
  {
    // A developer tools extension, and the pane opens no developer tools.
    name: "React Developer Tools",
    manifest: manifest({
      background: worker,
      permissions: ["scripting", "storage", "tabs"],
      devtools_page: "main.html",
      action: { default_popup: "popups/disabled.html" },
    }),
    expected: { level: "partial", missing: ["popup", "devtools"] },
  },
  {
    // Built around the desktop app; content scripts alone cannot fill in a password.
    name: "a password manager without a background",
    manifest: manifest({ permissions: ["nativeMessaging", "storage", "https://*/*"] }),
    expected: { level: "unsupported", cause: "native", missing: ["native"] },
  },
  {
    name: "an extension that asks for a permission this list does not know",
    manifest: manifest({ permissions: ["tts", "storage"], action: {} }),
    expected: { level: "partial", missing: ["toolbar", "other"] },
  },
])("$name", (row) => {
  expect(extensionCompatibility(row.manifest)).toEqual(row.expected)
})
