import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"
import { devices, previewScales } from "./viewport-presets"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

const detail = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))

const binding = text(128)

export const PluginTabHandle = text(128).pipe(Schema.brand("ExperimentalBrowserTab"))

/** The longest page icon data URL main reports: a 32px PNG is a few kilobytes; larger icons are dropped. */
export const MAX_ICON_URL = 24_576

const dimension = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 }))

/** The layout viewport in guest CSS pixels. Preview scaling is local to the displayed view. */
export const Viewport = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("auto") }),
  Schema.Struct({
    mode: Schema.Literal("fixed"),
    width: dimension,
    height: dimension,
    // Omit scale to fit the pane.
    scale: Schema.optional(Schema.Literals(previewScales)),
    // The selected device survives rotation; custom dimensions have no preset.
    preset: Schema.optionalKey(Schema.Literals(devices.map((device) => device.id))),
  }),
])

export type Viewport = typeof Viewport.Type

/** An element the user picked in the page. The ref stays valid for browser tools until the page navigates. */
export const PaneElement = Schema.Struct({
  ref: Browser.Ref,
  selector: detail(2_048),
  label: detail(512),
  role: Schema.optionalKey(detail(128)),
  name: Schema.optionalKey(detail(512)),
  text: Schema.optionalKey(detail(512)),
  /** Border box in the native view's DIPs. */
  rect: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
})

export type PaneElement = typeof PaneElement.Type

const FindAction = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["open", "close", "previous", "next"]) }),
  Schema.Struct({ type: Schema.Literal("query"), query: detail(4096) }),
])

export type FindAction = typeof FindAction.Type

const FindView = Schema.Struct({
  query: detail(4096),
  result: Schema.NullOr(Schema.Struct({ active: Schema.Int, total: Schema.Int })),
})

export type FindView = typeof FindView.Type

const RefusalNotice = Schema.Union([
  Schema.Struct({ reason: Schema.Literals(["browser.address.credentials", "browser.address.workspace", "browser.address.web", "browser.preview.restricted", "browser.preview.agentRestricted"]), source: Schema.optionalKey(Schema.Literal("conversation")) }),
  // A site asked for a passkey or security key, refused at once: this browser shows no request for it, in a tab of the
  // person's or (`agent`) one the agent drives; or (`off`) the system's dialog would answer, but the tab refuses since
  // the agent used it or a window linked to it. `site` is the page's registrable domain.
  Schema.Struct({
    reason: Schema.Literals(["browser.passkey", "browser.passkey.agent", "browser.passkey.off"]),
    site: Schema.optionalKey(text(255)),
  }),
  Schema.Struct({ reason: Schema.Literal("external"), target: text(2048), source: Schema.Literals(["conversation", "page"]), action: Schema.Literals(["open", "copy"]) }),
  Schema.Struct({ reason: Schema.Literal("popup"), target: text(16384), action: Schema.optionalKey(Schema.Literal("tab")) }),
])

export type RefusalNotice = typeof RefusalNotice.Type

/**
 * Who asks, as the pane names it: a web site by its host (ASCII, punycode for international names, shortened at the
 * start when long), a local file, or a page with no origin to name. `embedded` is a frame of another origin than the
 * tab's page.
 */
const PromptSite = Schema.Struct({
  kind: Schema.Literals(["web", "file", "page"]),
  host: detail(80),
  embedded: Schema.Boolean,
})

export type PromptSite = typeof PromptSite.Type

/** The longest page-supplied text a prompt shows: a dialog's message, its prompt's default value, a sign-in realm. */
export const PROMPT_TEXT_MAX = 2_000

/** The longest user name or password a sign-in sends; the form stops there, so the answer always passes. */
export const SIGN_IN_TEXT_MAX = 1_024

/**
 * What a tab waits on the user for, which only the window shows and only the user answers. `waiting` counts the
 * others behind it. `focus` is true when the prompt takes the keyboard as it shows: a dialog in the tab in front of a
 * focused window, a bar only from its page. Each kind:
 * - `dialog`: the page's `alert`, `confirm` or `prompt`; `stop` offers to stop the page's dialogs.
 * - `leave`: the page asks to confirm before the user leaves it.
 * - `permission`: a site asks for features; `remember` offers to keep the decision in the profile (`kept`) or for a
 *   remote server until the app quits (`session`); `agent` says the agent drives the tab, so the answer is for this
 *   request only.
 * - `auth`: a site asks for a user name and password; `failed` when it refused the last ones.
 * - `system`: the system's privacy settings blocked a device the user allowed.
 */
export const PromptView = Schema.Struct({
  id: Schema.Int,
  /** How many times the page asked for what shows: a repeat shows it anew, so its input protection starts over. */
  asked: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  waiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  focus: Schema.Boolean,
  /** The page held the keyboard as the prompt showed: it gets it back afterwards, so the window restores nothing. */
  page: Schema.Boolean,
  ask: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("dialog"),
      dialog: Schema.Literals(["alert", "confirm", "prompt"]),
      site: PromptSite,
      message: detail(PROMPT_TEXT_MAX),
      value: detail(PROMPT_TEXT_MAX),
      stop: Schema.Boolean,
    }),
    Schema.Struct({ kind: Schema.Literal("leave") }),
    Schema.Struct({
      kind: Schema.Literal("permission"),
      site: PromptSite,
      permissions: Schema.Array(Schema.Literals(["camera", "microphone", "location", "notifications", "clipboard-read"])),
      remember: Schema.Literals(["kept", "session", "none"]),
      agent: Schema.Boolean,
      /** macOS asks next, once the user allows the site: it has not asked about the device yet. */
      system: Schema.Boolean,
    }),
    Schema.Struct({ kind: Schema.Literal("auth"), host: text(80), realm: detail(256), failed: Schema.Boolean }),
    Schema.Struct({
      kind: Schema.Literal("system"),
      device: Schema.Literals(["camera", "microphone"]),
      platform: Schema.Literals(["darwin", "win32", "other"]),
    }),
  ]),
})

export type PromptView = typeof PromptView.Type

/**
 * The user's answer to the prompt `id` of a kind. `dismiss` closes it with the page's default: a permission is denied
 * this time and nothing is kept, a sign-in is cancelled. The sign-in's user name and password go only to Chromium.
 */
const PromptAnswer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("dialog"),
    accept: Schema.Boolean,
    text: detail(PROMPT_TEXT_MAX),
    stop: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("leave"), leave: Schema.Boolean }),
  Schema.Struct({
    kind: Schema.Literal("permission"),
    allow: Schema.Boolean,
    remember: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("auth"), username: detail(SIGN_IN_TEXT_MAX), password: detail(SIGN_IN_TEXT_MAX) }),
  Schema.Struct({ kind: Schema.Literal("dismiss") }),
])

export type PromptAnswer = typeof PromptAnswer.Type

export const PaneEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("find"), tabID: Browser.TabID, view: Schema.NullOr(FindView) }),
    Schema.Struct({ type: Schema.Literal("refusal"), tabID: Browser.TabID, notice: RefusalNotice, token: text(128), site: Schema.optional(Schema.String) }),
  // What the tab waits on the user for; null once nothing waits.
  Schema.Struct({ type: Schema.Literal("prompt"), tabID: Browser.TabID, prompt: Schema.NullOr(PromptView) }),
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  // What the agent did on the tab asks of the pane. `none`: nothing, the tab is only marked. `pane`: a closed pane
  // opens on the tab. `tab`: the tab is selected, in a closed pane or in an open one that shows another tab.
  Schema.Struct({ type: Schema.Literal("activity"), tabID: Browser.TabID, reveal: Schema.Literals(["none", "pane", "tab"]) }),
  Schema.Struct({ type: Schema.Literal("preview"), path: text(2_048) }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
  // A tab's page exists; the renderer lays it out through this host embed.
  Schema.Struct({ type: Schema.Literal("embed"), tabID: Browser.TabID, embed: text(256) }),
  // The page's element picker started, stopped, or picked an element.
  Schema.Struct({
    type: Schema.Literal("inspect"),
    tabID: Browser.TabID,
    active: Schema.Boolean,
    element: Schema.optionalKey(PaneElement),
  }),
  // Presentation details belong to this desktop's page, outside the server's tab inventory.
  Schema.Struct({
      type: Schema.Literal("page"),
      tabID: Browser.TabID,
      retryOnly: Schema.optionalKey(Schema.Boolean),
    icon: Schema.optionalKey(detail(MAX_ICON_URL).check(Schema.isStartingWith("data:image/"))),
    zoom: Schema.Finite.check(Schema.isBetween({ minimum: 0.25, maximum: 5 })),
    viewport: Viewport,
    viewportNotice: Schema.optionalKey(Schema.Literals(["zoom", "failed"])),
  }),
  // The user put keyboard focus in the page, outside the window's own document.
  Schema.Struct({ type: Schema.Literal("focused"), tabID: Browser.TabID }),
  // The app menu's "Reload ignoring cache". The window runs it on the pane it shows, as the person's own command: only
  // the window knows which session's pane is on screen, and a failed page has no native view to tell main.
  Schema.Struct({ type: Schema.Literal("hardReload") }),
  // The page handed a browser or shell shortcut to the window, which runs it as its own key press.
  Schema.Struct({
    type: Schema.Literal("shortcut"),
    key: text(64),
    code: detail(64),
    ctrl: Schema.Boolean,
    meta: Schema.Boolean,
    shift: Schema.Boolean,
    alt: Schema.Boolean,
  }),
])

export type PaneEvent = typeof PaneEvent.Type

/**
 * The `error` of the last `state` event of a binding that main closed. Other errors on a `state` event, such as
 * `"page_crashed"` or a refused address, leave the binding open.
 *
 * - `"browser.pane.unsupported"`: the server has no browser plugin, or its `attached` handshake names a protocol this
 *   desktop cannot speak. The event carries no tabs. A control event of an unknown type closes nothing.
 * - `"browser.pane.replaced"`: another window attached to the same session. The event carries no tabs.
 * - `"browser.pane.suspended"`: the server dropped an attached binding (idle eviction), or main's plugin is going away.
 *   The event carries the tabs the binding had.
 * - `"browser.pane.missing"`: the session no longer exists. The event carries no tabs, and main forgot its saved tabs.
 * - `"browser.pane.registration.closed"`: the stream or attachment ended, registration timed out, the window navigated
 *   or closed, or the window closed the binding. The event carries no tabs; the window may register again.
 */
export const PaneCloseReason = Schema.Literals([
  "browser.pane.unsupported",
  "browser.pane.replaced",
  "browser.pane.suspended",
  "browser.pane.missing",
  "browser.pane.registration.closed",
])

export type PaneCloseReason = typeof PaneCloseReason.Type

/**
 * The native browser pane in the main process. A binding is one registration of a session's pane
 * by a window; its events go to that window only.
 */
export const BrowserPane = Ipc.define({
  id: "browser.pane",
  methods: {
    register: {
      input: Schema.Struct({
        binding,
        server: text(16_384),
        session: text(256).check(Schema.isStartingWith("ses")),
        restore: Schema.optionalKey(Browser.State),
      }),
    },
    // Creates the page of a restored tab the first time the pane shows it.
    load: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    command: { input: Schema.Struct({ binding, command: Browser.Action }) },
    createTab: { input: Schema.Struct({ binding, owner: text(128), url: text(16_384) }), output: PluginTabHandle },
    closeTab: { input: Schema.Struct({ binding, owner: text(128), id: PluginTabHandle }), output: Schema.Boolean },
    find: { input: Schema.Struct({ binding, tabID: Browser.TabID, action: FindAction }) },
    notice: { input: Schema.Struct({ binding, tabID: Browser.TabID, token: text(128), dismiss: Schema.Boolean, copy: Schema.optional(Schema.Boolean) }) },
    reviewLink: { input: Schema.Struct({ binding, url: text(2048) }), output: Browser.TabID },
    // The user answers what the tab waits for; an answer to a prompt that already ended does nothing.
    answer: { input: Schema.Struct({ binding, tabID: Browser.TabID, id: Schema.Int, answer: PromptAnswer }) },
    // Starts or stops the page's element picker; the page reports picks and exits as inspect events.
    inspect: { input: Schema.Struct({ binding, tabID: Browser.TabID, enabled: Schema.Boolean }) },
    // Highlights a picked element briefly, or clears any highlight when ref is omitted.
    highlight: { input: Schema.Struct({ binding, tabID: Browser.TabID, ref: Schema.optionalKey(Browser.Ref) }) },
    // Zooms the page one step in or out, or back to 100%; the page reports its new zoom as a page event.
    zoom: {
      input: Schema.Struct({ binding, tabID: Browser.TabID, zoom: Schema.Literals(["in", "out", "reset"]) }),
    },
    setViewport: { input: Schema.Struct({ binding, tabID: Browser.TabID, viewport: Viewport }) },
    // The site data the page's address can read in this desktop's browser: its cookie count. Zero for a page that is
    // not a web page.
    site: {
      input: Schema.Struct({ binding, tabID: Browser.TabID }),
      output: Schema.Struct({ cookies: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
    },
    // Deletes the cookies the page's address can read and its origin's stored data, then reloads the page.
    clearSite: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    clearCache: { input: Schema.Struct({ binding, tabID: Browser.TabID, address: text(16_384) }) },
    reveal: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    openPage: { input: Schema.Struct({ binding, tabID: Browser.TabID, expected: text(16_384) }) },
    close: { input: Schema.Struct({ binding }) },
    forget: { input: Schema.Struct({server:text(16_384),session:text(256).check(Schema.isStartingWith("ses"))}) },
  },
  events: {
    event: Schema.Struct({ binding: Schema.String, event: PaneEvent }),
  },
})
