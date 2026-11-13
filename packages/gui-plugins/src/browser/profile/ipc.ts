import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

/**
 * A part of an extension that does not work in this browser, by what the user would notice.
 * - `blocking`: blocking or changing requests (`webRequestBlocking`, `declarativeNetRequest`).
 * - `network`: watching requests (`webRequest`).
 * - `toolbar`: a toolbar button without a popup, which only tells the extension it was clicked.
 * - `popup`: a toolbar popup about the current page; here it opens as a tab of its own.
 * - `menus`: right-click menu items. `shortcuts`: keyboard shortcuts. `native`: an app on the computer.
 * - `signin`: signing in with a browser account. `sidePanel`: a side panel. `notifications`: system notifications.
 * - `navigation`: following page navigation. `cookies`: reading and changing cookies.
 * - `browserData`: history, bookmarks, sessions and downloads. `settings`: browser settings such as privacy or fonts.
 * - `addressBar`: an address bar keyword. `newTab`: replacing the new tab page. `devtools`: a developer tools panel.
 * - `access`: asking for more access after install. `userScripts`: user scripts. `other`: any other missing API.
 */
export const ExtensionFeature = Schema.Literals([
  "blocking",
  "network",
  "toolbar",
  "popup",
  "menus",
  "shortcuts",
  "native",
  "signin",
  "sidePanel",
  "notifications",
  "navigation",
  "cookies",
  "browserData",
  "settings",
  "addressBar",
  "newTab",
  "devtools",
  "access",
  "userScripts",
  "other",
])

export type ExtensionFeature = typeof ExtensionFeature.Type

/**
 * Whether an extension works in this browser, from what its manifest declares.
 * - `supported`: everything it declares works here.
 * - `partial`: it runs, but `missing` does not work.
 * - `unsupported`: it will not do its job here, for `cause`: `startup`, its background script needs an API this
 *   browser lacks and stops when it starts; `blocking`, it blocks or changes requests; `native`, it needs an app on
 *   the computer.
 */
export const ExtensionCompatibility = Schema.Struct({
  level: Schema.Literals(["supported", "partial", "unsupported"]),
  cause: Schema.optional(Schema.Literals(["startup", "blocking", "native"])),
  missing: Schema.Array(ExtensionFeature),
})

export type ExtensionCompatibility = typeof ExtensionCompatibility.Type

/** An extension the desktop browser installed, as the window lists it. */
export const ProfileExtension = Schema.Struct({
  id: text(64),
  name: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
  /** `folder`: loaded in place from a directory the user picked. `store`: from a store listing. `browser`: copied from another browser's profile. */
  source: Schema.Literals(["folder", "store", "browser"]),
  icon: Schema.optional(Schema.String.check(Schema.isStartingWith("data:image/"))),
  /** The `chrome-extension://` page its toolbar button opens. */
  popup: Schema.optional(Schema.String),
  /** Its options page. */
  options: Schema.optional(Schema.String),
  /** Why an enabled extension did not load. */
  error: Schema.optional(Schema.String),
  compatibility: ExtensionCompatibility,
})

export type ProfileExtension = typeof ProfileExtension.Type

/** A browser installed on this machine and its profiles with cookies. */
export const ProfileSource = Schema.Struct({
  id: text(64),
  name: Schema.String,
  engine: Schema.Literals(["chromium", "firefox", "safari"]),
  /** The browser's own icon as a data URL, where its application was found. */
  icon: Schema.optional(Schema.String.check(Schema.isStartingWith("data:image/"))),
  profiles: Schema.Array(Schema.Struct({ id: text(512), name: Schema.String })),
})

export type ProfileSource = typeof ProfileSource.Type

/**
 * How a cookie import ended.
 * - `imported`: `imported` cookies were written; `skipped` were expired or partitioned, `protected` were encrypted with a
 *   key only the source browser can use (Chrome and Edge app-bound encryption on Windows), `failed` did not decrypt.
 * - `failed`: nothing was read. `key`: the browser's key was not available, e.g. a denied Keychain prompt. `access`: the
 *   system denied access, e.g. Safari without Full Disk Access. `locked`: the browser runs and holds its cookies open,
 *   as Chromium does on Windows. `read`: the profile could not be read. `format`: the
 *   file is not a cookie export. `storage`: this profile cannot save cookies (see `summary`), so nothing was imported.
 */
export const ImportResult = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("imported"),
    imported: Count,
    skipped: Count,
    protected: Count,
    failed: Count,
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    reason: Schema.Literals(["key", "access", "locked", "read", "format", "storage"]),
  }),
])

export type ImportResult = typeof ImportResult.Type

/**
 * How an extension install ended.
 * - `manifest`: the directory or package has no extension manifest, or a theme's.
 * - `download`: the store did not serve the package.
 * - `load`: Chromium refused the extension; `message` says why.
 *
 * `unsupported`: nothing was installed, because the extension will not work here; installing again with `force` adds
 * it anyway.
 */
export const InstallResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("installed"), extension: ProfileExtension }),
  Schema.Struct({
    type: Schema.Literal("unsupported"),
    name: Schema.String,
    icon: Schema.optional(Schema.String.check(Schema.isStartingWith("data:image/"))),
    compatibility: ExtensionCompatibility,
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    reason: Schema.Literals(["manifest", "download", "load"]),
    message: Schema.optionalKey(Schema.String),
  }),
])

export type InstallResult = typeof InstallResult.Type

const SourceProfile = { source: text(64), profile: text(512) }

/**
 * The desktop browser's profile: one set of cookies, site data and extensions for every session, project and server
 * of this desktop app. Its state lists the extensions; it changes after every install, removal and toggle.
 */
export const BrowserProfile = Ipc.define({
  id: "browser.profile",
  state: Schema.Struct({ extensions: Schema.Array(ProfileExtension) }),
  methods: {
    sources: { output: Schema.Array(ProfileSource) },
    importBrowser: { input: Schema.Struct(SourceProfile), output: ImportResult },
    /** A Netscape `cookies.txt`, a JSON cookie export or a Playwright storage state. */
    importFile: { input: Schema.Struct({ path: text(4096) }), output: ImportResult },
    /**
     * The stored cookies and their sites. `persistent` is false when cookies never reach disk: with cookie encryption
     * on, Chromium keeps them in memory only while the system key store refuses its key, so sign-ins end with the app.
     */
    summary: { output: Schema.Struct({ cookies: Count, sites: Count, persistent: Schema.Boolean }) },
    /** Signs out everywhere: deletes every cookie, cache and site's stored data. Extensions stay. */
    clear: {},
    /** The extensions a Chromium profile has installed. */
    browserExtensions: {
      input: Schema.Struct(SourceProfile),
      output: Schema.Array(
        Schema.Struct({
          id: text(64),
          name: Schema.String,
          version: Schema.String,
          icon: Schema.optional(Schema.String),
          installed: Schema.Boolean,
          compatibility: ExtensionCompatibility,
        }),
      ),
    },
    /** Adds an extension. One that will not work here is added only with `force`. */
    install: {
      input: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("folder"), path: text(4096), force: Schema.optional(Schema.Boolean) }),
        Schema.Struct({ kind: Schema.Literal("store"), url: text(2048), force: Schema.optional(Schema.Boolean) }),
        Schema.Struct({
          kind: Schema.Literal("browser"),
          ...SourceProfile,
          id: text(64),
          force: Schema.optional(Schema.Boolean),
        }),
      ]),
      output: InstallResult,
    },
    remove: { input: Schema.Struct({ id: text(64) }) },
    enable: { input: Schema.Struct({ id: text(64), enabled: Schema.Boolean }) },
  },
})
