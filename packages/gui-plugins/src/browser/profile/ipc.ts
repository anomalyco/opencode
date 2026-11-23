import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin-browser/rpc"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** An image as a data URL, as icons cross to the window. */
const DataImage = Schema.String.check(Schema.isStartingWith("data:image/"))

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

/**
 * A part of an extension that does not work in this browser, by what the user would notice.
 * - `network`: watching requests (`webRequest`) from a service worker.
 * - `shortcuts`: keyboard shortcuts. `native`: an app on the computer.
 * - `pageSync`: what its scripts in web pages do with settings they read from `chrome.storage.sync`, which those
 *   scripts cannot reach here.
 * - `signin`: signing in with a browser account. `sidePanel`: a side panel.
 * - `browserData`: history, bookmarks, sessions and downloads. `settings`: browser settings such as privacy or fonts.
 * - `addressBar`: an address bar keyword. `newTab`: replacing the new tab page. `devtools`: a developer tools panel.
 * - `access`: asking for more access after install. `userScripts`: user scripts. `other`: any other missing API.
 */
export const ExtensionFeature = Schema.Literals([
  "network",
  "shortcuts",
  "native",
  "pageSync",
  "signin",
  "sidePanel",
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
 *   browser lacks and stops when it starts.
 */
export const ExtensionCompatibility = Schema.Struct({
  level: Schema.Literals(["supported", "partial", "unsupported"]),
  cause: Schema.optional(Schema.Literals(["startup"])),
  missing: Schema.Array(ExtensionFeature),
})

export type ExtensionCompatibility = typeof ExtensionCompatibility.Type

/**
 * What an extension can do once added, from its manifest, shown before it is added.
 * - `allSites`: read and change every website's pages. `someSites`: some websites' pages.
 * - `cookies`: read and change cookies, sign-ins included, on those sites.
 * - `activity`: see the address of every page the user visits. `clipboard`: read what the user copies.
 */
export const ExtensionAccess = Schema.Literals([
  "allSites",
  "someSites",
  "cookies",
  "requests",
  "activity",
  "extensions",
  "clipboard",
])

export type ExtensionAccess = typeof ExtensionAccess.Type

export const ReviewedGrants = Schema.Struct({
  access: Schema.Array(ExtensionAccess),
  hosts: Schema.Array(Schema.String),
  permissions: Schema.Array(Schema.String),
})

export type ReviewedGrants = typeof ReviewedGrants.Type

/** An extension the desktop browser installed, as the window lists it. */
export const ProfileExtension = Schema.Struct({
  id: text(64),
  name: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
  /** `folder`: from a directory the user picked. `store`: from a store listing. `browser`: from another browser's profile. */
  source: Schema.Literals(["folder", "store", "browser"]),
  icon: Schema.optional(DataImage),
  /** The `chrome-extension://` page its toolbar button opens. */
  popup: Schema.optional(Schema.String),
  /** Its options page. */
  options: Schema.optional(Schema.String),
  /** Why an enabled extension did not load. */
  error: Schema.optional(Schema.String),
  changed: Schema.optional(Schema.Boolean),
  compatibility: ExtensionCompatibility,
  access: Schema.Array(ExtensionAccess),
  /**
   * Its toolbar button, for an extension that has one: what it set for the active tab of the last window. `icon`
   * replaces the extension's own while set; `badge` is the short text over it, in `badgeColor` and `badgeTextColor`.
   */
  action: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      icon: Schema.optional(DataImage),
      badge: Schema.optional(Schema.String),
      badgeColor: Schema.optional(Schema.String),
      badgeTextColor: Schema.optional(Schema.String),
      enabled: Schema.Boolean,
    }),
  ),
})

export type ProfileExtension = typeof ProfileExtension.Type

/** A browser installed on this machine and its profiles with cookies. */
export const ProfileSource = Schema.Struct({
  id: text(64),
  name: Schema.String,
  engine: Schema.Literals(["chromium", "firefox", "safari"]),
  /** The browser's own icon as a data URL, where its application was found. */
  icon: Schema.optional(DataImage),
  profiles: Schema.Array(Schema.Struct({ id: text(4096), name: Schema.String })),
})

export type ProfileSource = typeof ProfileSource.Type

/**
 * How a cookie import ended.
 * - `imported`: `imported` cookies were written; `skipped` were expired or partitioned, `protected` were encrypted with a
 *   key only the source browser can use (Chrome and Edge app-bound encryption on Windows), `failed` did not decrypt.
 *   `pages` is how many pages of the browser's history came too: absent for a cookie file, or when history was not
 *   asked for. History that could not be read is 0 pages, never a failure.
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
    pages: Schema.optional(Count),
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
 * `unsupported`: nothing was installed, because the extension will not work here; `review`: nothing was installed yet,
 * because the extension asks for access. Approving its one-use token installs only the reviewed copy.
 */
export const InstallResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("installed"), extension: ProfileExtension }),
  Schema.Struct({
    type: Schema.Literals(["unsupported", "review"]),
    token: text(64),
    id: text(64),
    store: Schema.optional(Schema.Literals(["chrome", "edge"])),
    ...ReviewedGrants.fields,
    sites: Schema.Array(Schema.String),
    added: Schema.optional(ReviewedGrants),
    replaces: Schema.optional(Schema.String),
    name: Schema.String,
    icon: Schema.optional(DataImage),
    compatibility: ExtensionCompatibility,
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    reason: Schema.Literals(["manifest", "download", "load", "collision", "expired"]),
    message: Schema.optionalKey(Schema.String),
  }),
])

export type InstallResult = typeof InstallResult.Type

/** A site of another browser's profile: its registrable domain, or its IP address, and how many cookies would import. */
export const ProfileSite = Schema.Struct({ site: text(255), cookies: Count })

export type ProfileSite = typeof ProfileSite.Type

/**
 * The sites a browser profile has cookies for, read without any cookie's name or value: the ones used most recently
 * first (`order: "recent"`), or by name where the browser records no last use (`"name"`, Safari). `failed` says why
 * there is no list, with the reasons of `ImportResult`.
 */
export const SiteList = Schema.Union([
  Schema.Struct({ type: Schema.Literal("listed"), sites: Schema.Array(ProfileSite), order: Schema.Literals(["recent", "name"]) }),
  Schema.Struct({ type: Schema.Literal("failed"), reason: Schema.Literals(["access", "locked", "read"]) }),
])

export type SiteList = typeof SiteList.Type

const SourceProfile = { source: text(64), profile: text(4096) }

/**
 * The desktop browser's profile: one set of cookies, site data and extensions for every session, project and server
 * of this desktop app. Its state lists the extensions; it changes after every install, removal and toggle.
 * `remoteSignIns` is whether remote servers' pages share the profile's cookies, both ways; off by default, and
 * undefined until the profile loads.
 */
export const BrowserProfile = Ipc.define({
  id: "browser.profile",
  state: Schema.Struct({
    extensions: Schema.Array(ProfileExtension),
    remoteSignIns: Schema.optional(Schema.Boolean),
  }),
  methods: {
    sources: { output: Schema.Array(ProfileSource) },
    /** The sites a browser profile has cookies for; see `SiteList`. Only the window's import dialog asks. */
    sites: { input: Schema.Struct(SourceProfile), output: SiteList },
    /**
     * Imports from a browser profile what the person ticked in the import dialog: its cookies, its browsing history,
     * or both; all of each, or with `sites` only those of the sites `sites` returned that the user chose.
     * - Cookies come unless `cookies` is false. Cookies already in the profile stay, so a later import adds more
     *   sites. With `cookies` false none is read or written, and the other browser's cookie key is not asked for.
     * - With `history`, the profile's browsing history comes, for the address field to complete from, and the
     *   result's `pages` counts it. Without it no page is read and the history store is not opened.
     */
    importBrowser: {
      input: Schema.Struct({
        ...SourceProfile,
        sites: Schema.optional(Schema.Array(text(255)).check(Schema.isMaxLength(100_000))),
        history: Schema.optional(Schema.Boolean),
        cookies: Schema.optional(Schema.Boolean),
      }),
      output: ImportResult,
    },
    /** A Netscape `cookies.txt`, a JSON cookie export or a Playwright storage state. */
    importFile: { input: Schema.Struct({ path: text(4096) }), output: ImportResult },
    /**
     * The stored cookies and their sites. `persistent` is false when cookies never reach disk: with cookie encryption
     * on, Chromium keeps them in memory only while the system key store refuses its key, so sign-ins end with the app.
     */
    summary: { output: Schema.Struct({ cookies: Count, persistent: Schema.Boolean }) },
    /** Turns sharing the profile's sign-ins with remote servers' pages on or off; see the state's `remoteSignIns`. */
    shareSignIns: { input: Schema.Struct({ enabled: Schema.Boolean }) },
    /**
     * Signs out everywhere: deletes every cookie, cache, site's stored data and HTTP sign-in, and the browsing history.
     * Extensions and the site permissions the user kept stay. The sign-out does not depend on the history: it rejects
     * only when the sign-out itself failed, and `history` is false when the history could not be cleared, so the window
     * never says that it went.
     */
    clear: { output: Schema.Struct({ history: Schema.Boolean }) },
    /** The extensions a Chromium profile has installed. */
    browserExtensions: {
      input: Schema.Struct(SourceProfile),
      output: Schema.Array(
        Schema.Struct({
          id: text(64),
          name: Schema.String,
          version: Schema.String,
          icon: Schema.optional(DataImage),
          installed: Schema.Boolean,
          compatibility: ExtensionCompatibility,
          access: Schema.Array(ExtensionAccess),
        }),
      ),
    },
    /** Stages a package for review or approves the staged copy named by a review token. */
    install: {
      input: Schema.Union([
        Schema.Struct({ kind: Schema.Literal("approve"), token: text(64) }),
        Schema.Struct({ kind: Schema.Literal("folder"), path: text(4096) }),
        Schema.Struct({ kind: Schema.Literal("store"), url: text(2048) }),
        Schema.Struct({
          kind: Schema.Literal("browser"),
          ...SourceProfile,
          id: text(64),
        }),
      ]),
      output: InstallResult,
    },
    remove: { input: Schema.Struct({ id: text(64) }) },
    /**
     * The user chose an extension in the pane's extensions menu, whose button sits at `anchor` in the window's
     * content, in CSS pixels: its popup opens with its top edge on `pageTop`, the top of the page area under the
     * toolbar and its bars, and its right edge on the button's, or its left edge when the toolbar runs right to left
     * (`rtl`). Or the extension hears the click. Main bounds all of it (`popupBounds`). False when the extension has
     * no toolbar button, so the window opens its options page instead.
     */
    click: {
      input: Schema.Struct({
        binding: text(256),
        tabID: Browser.TabID,
        id: text(64),
        anchor: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
        pageTop: Schema.Finite,
        rtl: Schema.Boolean,
      }),
      output: Schema.Boolean,
    },
    enable: { input: Schema.Struct({ id: text(64), enabled: Schema.Boolean }) },
  },
  events: {
    /** The profile's cookies changed, once a burst of changes settles: read `summary` again. */
    cookies: Schema.Struct({}),
  },
})
