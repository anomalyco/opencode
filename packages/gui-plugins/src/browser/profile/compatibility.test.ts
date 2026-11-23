import { expect, test } from "bun:test"
import { extensionAccess, extensionCompatibility, reviewHosts } from "./compatibility"
import type { Manifest } from "./extensions"
import { reviewAccess } from "./review"

const manifest = (fields: Partial<Manifest>): Manifest => ({ manifest_version: 3, name: "x", version: "1", ...fields })

test("review groups by registrable site without collapsing private suffix tenants or hiding broader updates", () => {
  const sites = ["https://news.example.co.uk/*", "https://*.example.co.uk/*", "https://one.github.io/*", "https://two.github.io/*", "http://localhost/*", "https://*.com/*"]
  const original = reviewAccess(manifest({ host_permissions: sites }))
  expect(original.sites).toEqual(["*.com", "example.co.uk", "localhost", "one.github.io", "two.github.io"])
  expect(original.grants.hosts).toHaveLength(sites.length)
  expect(reviewAccess(manifest({ host_permissions: sites, permissions: ["webNavigation"] }), original.grants).added)
    .toEqual({ access: ["activity"], hosts: [], permissions: ["webNavigation"] })
  expect(reviewAccess(manifest({ host_permissions: [sites[0]] }), original.grants).added).toBeUndefined()
  expect(reviewAccess(manifest({ host_permissions: ["<all_urls>"] }), original.grants).added?.access).toEqual(["allSites"])
})

// Grants saved before the review named request rules hold the permission but not the access line.
test("an update asks again only for access its permissions add, not for a line the review learned to say since", () => {
  const blocker = manifest({ permissions: ["declarativeNetRequest", "storage"], host_permissions: ["https://*.example.com/*"] })
  const saved = { access: ["someSites" as const], hosts: ["https://*.example.com/*"], permissions: ["declarativeNetRequest", "storage"] }

  expect(reviewAccess(blocker, saved).added).toBeUndefined()
  expect(reviewAccess(manifest({ ...blocker, permissions: ["declarativeNetRequest", "storage", "management"] }), saved).added).toEqual({
    access: ["extensions"],
    hosts: [],
    permissions: ["management"],
  })
  expect(reviewAccess(blocker, { ...saved, permissions: ["storage"] }).added?.access).toEqual(["requests"])
})

test("review counts distinct hosts across grants and content scripts and puts broad patterns before the display cutoff", () => {
  const sites = Array.from({ length: 12 }, (_, i) => `https://example${i}.test/*`)
  const hosts = reviewHosts(manifest({ host_permissions: sites, permissions: [sites[0], "cookies"], content_scripts: [{ matches: ["*://*.com/*", "<all_urls>"] }] }))
  expect(hosts).toHaveLength(14)
  expect(hosts.slice(0, 2)).toEqual(["<all_urls>", "*://*.com/*"])
})

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
      permissions: [
        "storage",
        "tabs",
        "webRequest",
        "webRequestBlocking",
        "contextMenus",
        "webNavigation",
        "<all_urls>",
      ],
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
    // Its worker and popup run, but its keys in web pages do nothing: the page scripts read their settings from
    // chrome.storage.sync, which content scripts do not have here.
    name: "Vimium",
    manifest: manifest({
      background: worker,
      permissions: [
        "tabs",
        "bookmarks",
        "history",
        "storage",
        "sessions",
        "notifications",
        "scripting",
        "webNavigation",
        "search",
        "favicon",
      ],
      content_scripts: [{ js: ["lib/settings.js", "content_scripts/link_hints.js"], all_frames: true }],
      action: { default_popup: "pages/action.html" },
    }),
    files: { pageSync: true },
    expected: { level: "partial", missing: ["pageSync", "browserData", "other"] },
  },
  {
    // `tabGroups` has events and nothing stands in for it here, so a worker that listens stops as it starts.
    name: "an extension whose worker listens to an API this browser lacks",
    manifest: manifest({ background: worker, permissions: ["tabGroups", "tts"] }),
    expected: { level: "unsupported", cause: "startup", missing: ["browserData", "other"] },
  },
])("$name", (row) => {
  expect(extensionCompatibility(row.manifest, row.files)).toEqual(row.expected)
})

test.each([
  {
    name: "a password manager",
    manifest: manifest({
      permissions: ["tabs", "cookies", "clipboardRead"],
      host_permissions: ["https://*/*", "http://*/*"],
    }),
    expected: ["allSites", "cookies", "activity", "clipboard"],
  },
  {
    name: "a content blocker for every page",
    manifest: manifest({ permissions: ["storage"], content_scripts: [{ matches: ["<all_urls>"], js: ["x.js"] }] }),
    expected: ["allSites"],
  },
  {
    name: "a site helper",
    manifest: manifest({ host_permissions: ["https://*.github.com/*"], permissions: ["webNavigation"] }),
    expected: ["someSites", "activity"],
  },
  {
    name: "a Manifest V2 extension with hosts among its permissions",
    manifest: manifest({ manifest_version: 2, permissions: ["*://*/*", "storage"] }),
    expected: ["allSites"],
  },
  {
    // uBlock Origin Lite: its rules block and redirect requests on every page with no host permission at all.
    name: "a rule-based content blocker",
    manifest: manifest({ permissions: ["declarativeNetRequest", "declarativeNetRequestFeedback", "scripting"] }),
    expected: ["requests", "activity"],
  },
  {
    name: "a proxy switcher",
    manifest: manifest({ permissions: ["proxy", "storage"] }),
    expected: ["allSites"],
  },
  {
    name: "an extension manager",
    manifest: manifest({ permissions: ["management", "declarativeNetRequestWithHostAccess"] }),
    expected: ["requests", "extensions"],
  },
  { name: "a formatter that asks for nothing", manifest: manifest({ permissions: ["storage"] }), expected: [] },
])("$name asks for $expected", (row) => {
  expect(extensionAccess(row.manifest)).toEqual([...row.expected])
})
