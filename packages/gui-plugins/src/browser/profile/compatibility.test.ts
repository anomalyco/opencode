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
    // Its popup toggles the page's dark theme; shortcuts are not bound and it gets no optional permission.
    name: "Dark Reader",
    manifest: manifest({
      background: worker,
      permissions: ["alarms", "fontSettings", "scripting", "storage"],
      optional_permissions: ["contextMenus"],
      commands: {},
      action: { default_popup: "ui/popup/index.html" },
    }),
    expected: { level: "partial", missing: ["shortcuts", "settings", "access"] },
  },
  {
    // Its worker starts and its popup shows the sign-in screen; a worker's webRequest listeners hear nothing.
    name: "Bitwarden",
    manifest: manifest({
      background: worker,
      permissions: ["storage", "tabs", "contextMenus", "webNavigation", "webRequest", "notifications", "sidePanel"],
      optional_permissions: ["nativeMessaging", "privacy"],
      action: { default_popup: "popup/index.html" },
      side_panel: {},
      commands: {},
    }),
    expected: { level: "partial", missing: ["native", "shortcuts", "sidePanel", "network", "settings", "access"] },
  },
  {
    // Its rulesets block and redirect requests; custom filters need user scripts.
    name: "uBlock Origin Lite",
    manifest: manifest({
      background: worker,
      permissions: ["activeTab", "declarativeNetRequest", "offscreen", "scripting", "storage", "userScripts"],
      declarative_net_request: {},
      action: { default_popup: "popup.html" },
      commands: {},
    }),
    expected: { level: "partial", missing: ["shortcuts", "userScripts"] },
  },
  {
    // Manifest V2: its background page blocks through chrome.webRequest and shows its count on the button.
    name: "uBlock Origin",
    manifest: manifest({
      manifest_version: 2,
      background: { page: "background.html" },
      permissions: ["storage", "tabs", "webRequest", "webRequestBlocking", "contextMenus", "webNavigation", "<all_urls>"],
      browser_action: { default_popup: "popup-fenix.html" },
    }),
    expected: { level: "supported", missing: [] },
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
    expected: { level: "partial", missing: ["devtools"] },
  },
  {
    // Built for the desktop app; this browser reaches no app on the computer.
    name: "a password manager that connects to its desktop app",
    manifest: manifest({ background: worker, permissions: ["nativeMessaging", "storage", "https://*/*"] }),
    expected: { level: "partial", missing: ["native"] },
  },
  {
    // `tabGroups` has events and nothing stands in for it here, so a worker that listens stops as it starts.
    name: "an extension whose worker listens to an API this browser lacks",
    manifest: manifest({ background: worker, permissions: ["tabGroups", "tts"] }),
    expected: { level: "unsupported", cause: "startup", missing: ["browserData", "other"] },
  },
])("$name", (row) => {
  expect(extensionCompatibility(row.manifest)).toEqual(row.expected)
})
