export * as Browser from "./rpc.js"

import { Schema } from "effect"
import { Rpc } from "@opencode/schema/rpc"
import { Session } from "@opencode/schema/session"
import { optional } from "@opencode/schema/schema"

/** The desktop and server must speak the same operation list; a mismatch is reported as unsupported. */
export const VERSION = 5
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const TUNNEL_CHUNK_BYTES = 64 * 1024
export const MAX_TEXT = 100_000
/** The longest an action waits for its element to become actionable, and the longest `wait` waits. */
export const MAX_WAIT_MS = 120_000
/** The longest `handoff` waits for the user. */
export const MAX_HANDOFF_MS = 30 * 60_000
const text = Schema.String.check(Schema.isMaxLength(MAX_TEXT))
const short = Schema.String.check(Schema.isMaxLength(2_048))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const limit = (maximum: number, fallback: number) =>
  optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }))).annotate({
    description: `Maximum entries, 1–${maximum}. Default ${fallback}.`,
  })
const timeoutMs = (fallback: number, maximum = MAX_WAIT_MS) =>
  optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }))).annotate({
    description: `Milliseconds to wait, 0–${maximum}. Default ${fallback}.`,
  })
export const TabID = Schema.String.check(Schema.isPattern(/^tab_[a-f0-9-]{36}$/))
  .pipe(Schema.brand("Browser.TabID"))
  .annotate({ identifier: "Browser.TabID" })
export type TabID = typeof TabID.Type
export const Ref = Schema.String.check(Schema.isPattern(/^@?e[1-9][0-9]*$/))
  .pipe(Schema.brand("Browser.Ref"))
  .annotate({ identifier: "Browser.Ref" })
export type Ref = typeof Ref.Type
export const FileID = Schema.String.check(Schema.isPattern(/^file_[a-f0-9-]{36}$/))
  .pipe(Schema.brand("Browser.FileID"))
  .annotate({ identifier: "Browser.FileID" })
export type FileID = typeof FileID.Type
/**
 * An element locator. One grammar for every element parameter, resolved when the action runs, so a re-rendered page
 * does not invalidate it.
 */
export const Locator = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)).annotate({
  identifier: "Browser.Locator",
  description:
    'Element locator: a ref such as "@e12" from snapshot or find; CSS such as "#save" or "form button.primary" (the default); "text=Save" (case-insensitive visible text, "text=\\"Save\\"" for an exact match); "role=button[name=\\"Send\\"]"; "label=Email"; "placeholder=Search"; "testid=submit"; "xpath=//main//a". Chain with " >> " to search inside the previous match and end with " >> nth=1" to pick one match (0-based, -1 is the last). Open shadow roots are searched. When several elements match, the first visible one is used.',
})
export type Locator = typeof Locator.Type
const tab = {
  tabID: TabID.annotate({
    description:
      "Exact tab ID returned by browser.tabs.open or browser.tabs.list. Focus does not select a target, so always pass it.",
  }),
}
const frame = {
  frameID: optional(short).annotate({ description: "Frame ID from browser.frames. Omit for the main frame." }),
}
const target = { target: Locator }
const optionalTarget = {
  target: optional(Locator).annotate({ description: "Element locator; omit for the whole page." }),
}
const script = {
  script: text.annotate({
    description:
      "JavaScript that runs in the page, never on the server. Write an expression (document.title), a function ((a, b) => a + b, called with args), or statements that end with return. Promises are awaited. Each call runs in its own scope, so const declarations do not collide between calls.",
  }),
  args: optional(Schema.Array(Schema.Json).check(Schema.isMaxLength(32))).annotate({
    description:
      "JSON values passed to a function script as its arguments, or available as args in other scripts. Use them instead of building strings, so quotes need no escaping.",
  }),
}
const waitUntil = {
  waitUntil: optional(Schema.Literals(["commit", "load", "idle"])).annotate({
    description:
      'When to return: "commit" once the new document starts, "load" once it finished loading (default), "idle" once no request ran for 500 ms after load.',
  }),
}
const serverPath = short.annotate({
  description: "Server-local file path, relative to the workspace or absolute. The server serves it to the tab.",
})
export const Viewport = Schema.Struct({
  width: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 4_000 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 200, maximum: 4_000 })),
  deviceScaleFactor: optional(Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 4 }))),
  mobile: optional(Schema.Boolean),
}).annotate({
  identifier: "Browser.Viewport",
  description:
    "Page size in CSS pixels, independent of the desktop window. deviceScaleFactor defaults to the display's; mobile emulates a touch phone layout.",
})
export type Viewport = typeof Viewport.Type
const colorScheme = optional(Schema.Literals(["light", "dark"])).annotate({
  description: "prefers-color-scheme the page sees.",
})

export interface Tab extends Schema.Schema.Type<typeof Tab> {}
export const Tab = Schema.Struct({
  id: TabID,
  url: Schema.String.check(Schema.isMaxLength(16_384)),
  title: short,
  loading: Schema.Boolean,
  loadError: optional(short),
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  generation: count,
  /** Who opened the tab: the agent's tabs render even while the user cannot see them. */
  owner: Schema.Literals(["agent", "user"]),
  /** The key the agent opened it with, which browser.tabs.open reuses. */
  key: optional(short),
  /** Whether the user can see the tab right now. */
  watched: Schema.Boolean,
  /** The page size the agent pinned with a viewport, if any. */
  viewport: optional(Schema.Struct({ width: count, height: count })),
}).annotate({ identifier: "Browser.Tab" })
export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({ tabs: Schema.Array(Tab), focusedTabID: Schema.NullOr(TabID) }).annotate({
  identifier: "Browser.State",
})
export interface FileInfo extends Schema.Schema.Type<typeof FileInfo> {}
export const FileInfo = Schema.Struct({
  id: FileID,
  name: short,
  mime: short,
  bytes: count,
  path: Schema.String,
}).annotate({ identifier: "Browser.FileInfo" })
export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  id: FileID,
  name: short,
  mime: short,
  data: Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(MAX_FILE_BYTES)),
}).annotate({ identifier: "Browser.File" })
const files = { files: Schema.Array(FileInfo) }
const page = { tab: Tab }
const saved = Schema.Struct({ ...page, ...files })
const level = Schema.Literals(["debug", "info", "warning", "error"])
export const ResourceType = Schema.Literals([
  "document",
  "stylesheet",
  "image",
  "media",
  "font",
  "script",
  "xhr",
  "fetch",
  "eventsource",
  "websocket",
  "manifest",
  "other",
]).annotate({ identifier: "Browser.ResourceType" })
export type ResourceType = typeof ResourceType.Type
const headers = Schema.Array(Schema.Struct({ name: short, value: text }))
export const Body = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["notRequested", "pending", "empty"]) }),
  Schema.Struct({ state: Schema.Literal("text"), text, truncated: Schema.Boolean }),
  Schema.Struct({
    state: Schema.Literal("unavailable"),
    reason: Schema.Literals(["binary", "notCaptured", "backendUnavailable"]),
  }),
]).annotate({ identifier: "Browser.Body" })
export type Body = typeof Body.Type
const requestFields = {
  id: short,
  url: text,
  method: short,
  resourceType: ResourceType,
  timestampMs: Schema.Finite,
  statusCode: optional(count),
}
export const NetworkRequest = Schema.Union([
  Schema.Struct({ ...requestFields, state: Schema.Literal("pending") }),
  Schema.Struct({ ...requestFields, state: Schema.Literal("completed"), durationMs: Schema.Finite }),
  Schema.Struct({ ...requestFields, state: Schema.Literal("failed"), durationMs: Schema.Finite, failure: short }),
]).annotate({ identifier: "Browser.NetworkRequest" })
export type NetworkRequest = typeof NetworkRequest.Type
export const SocketFrame = Schema.Struct({
  direction: Schema.Literals(["sent", "received"]),
  timestampMs: Schema.Finite,
  opcode: count,
  data: text,
  truncated: Schema.Boolean,
}).annotate({ identifier: "Browser.SocketFrame" })
export type SocketFrame = typeof SocketFrame.Type
export const ConsoleEntry = Schema.Struct({
  id: short,
  timestampMs: Schema.Finite,
  level,
  text,
  textTruncated: Schema.Boolean,
  source: optional(Schema.Struct({ url: text, line: count, column: count })),
}).annotate({ identifier: "Browser.ConsoleEntry" })
export interface ConsoleEntry extends Schema.Schema.Type<typeof ConsoleEntry> {}
const box = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })
export const Changed = Schema.Struct({
  navigated: Schema.Boolean,
  url: optional(text),
  title: optional(short),
  dialog: optional(Schema.Struct({ type: short, message: text })),
  errors: optional(Schema.Array(text)),
  matches: optional(count),
}).annotate({
  identifier: "Browser.Changed",
  description:
    "What the action changed: navigated, the new url/title when they changed, a dialog it opened, console errors it caused, and how many elements matched the locator.",
})
export type Changed = typeof Changed.Type
const acted = Schema.Struct({ ...page, changed: Changed })
export const Match = Schema.Struct({
  ref: Ref,
  tag: short,
  role: optional(short),
  name: optional(text),
  text: optional(text),
  visible: Schema.Boolean,
  box: optional(box),
  value: optional(text),
  attributes: optional(Schema.Record(Schema.String, text)),
  styles: optional(Schema.Record(Schema.String, text)),
  html: optional(text),
}).annotate({ identifier: "Browser.Match" })
export type Match = typeof Match.Type
const loaded = Schema.Struct({
  ...Tab.fields,
  status: optional(count).annotate({ description: "HTTP status of the main document, when known." }),
})
const metrics = Schema.Array(Schema.Struct({ name: short, value: Schema.Finite, unit: short }))
const node = Schema.Struct({ id: Schema.Finite, name: text, type: short, selfBytes: count, edgeCount: count })
const heapClasses = Schema.Array(Schema.Struct({ name: short, count, bytes: Schema.Finite }))
const recording = Schema.Struct({ ...page, recording: Schema.Boolean })

function operation<
  const Name extends string,
  const Fields extends Schema.Struct.Fields,
  Output extends Schema.Codec<unknown>,
>(name: Name, description: string, fields: Fields, output: Output, options: { readonly internal?: boolean } = {}) {
  return {
    name,
    description,
    // A guessed parameter name fails with the valid ones instead of being dropped silently.
    input: Schema.Struct(fields).annotate({
      parseOptions: { onExcessProperty: "error" },
      messageUnexpectedKey: `Not a parameter of browser.${name}. Valid parameters: ${Object.keys(fields).join(", ") || "none"}.`,
    }),
    output,
    action: Schema.Struct({ type: Schema.Literal(name), ...fields }),
    /** Desktop-only actions the pane's own controls send; never registered as agent tools. */
    internal: options.internal === true,
  }
}

export const Operations = [
  operation(
    "tabs.list",
    "List this session's browser tabs and the focused tab. Tabs show who opened them, their key, whether the user can see them, and any pinned viewport.",
    {},
    State,
  ),
  operation(
    "tabs.open",
    "Open a browser tab and wait for it to load. The agent's tabs render even while the user cannot see them, so every tool works on them in the background. Pass url for a web page or path for a local HTML file (the server serves its folder, so relative assets load). With key, an open tab with the same key is reused instead of opening a duplicate. localhost means the connected server.",
    {
      url: optional(short).annotate({ description: "HTTP/HTTPS URL or about:blank. Omit both url and path for a blank tab." }),
      path: optional(serverPath),
      key: optional(short).annotate({
        description:
          "Your own name for the tab. If a live tab already has this key it is reused (navigated when url or path differs) and returned with reused: true.",
      }),
      focus: optional(Schema.Boolean).annotate({
        description:
          "Default true: show the tab to the user in the Review pane. Pass false to work in the background; tools still work.",
      }),
      viewport: optional(Viewport),
      colorScheme,
      ...waitUntil,
      timeoutMs: timeoutMs(30_000),
    },
    Schema.Struct({ ...loaded.fields, reused: Schema.Boolean }),
  ),
  operation(
    "tabs.focus",
    "Show a tab to the user in the Review pane. Only for the user's benefit: no tool needs the tab to be focused or visible.",
    tab,
    Tab,
  ),
  operation(
    "tabs.close",
    "Close this browser tab, abort its work, and release its resources.",
    tab,
    State,
  ),
  operation(
    "preview",
    "Show a file to the user. Opens the file in the Review pane and focuses its tab for viewing. Images and screenshots (PNG, JPEG, GIF, WebP, charts, plots, photos), SVG, audio, video (MP4, WebM), PDF documents, HTML pages, Markdown, Mermaid diagrams, CSV and TSV tables, and fonts render as a media preview; code and other text files display highlighted source. Use this to present an artifact, output, or result you created or changed instead of pasting its contents, describing it, or opening a file:// URL in a browser tab. HTML pages open as a browser tab whose tabID works with every browser tool. The path is server-local: relative to the workspace or absolute.",
    { path: short.annotate({ description: "Server-local path to the file, relative to the workspace or absolute." }) },
    Schema.Struct({
      path: short,
      opened: Schema.Boolean.annotate({
        description: "false when the preview could not be shown now; reason explains it.",
      }),
      tabID: optional(TabID).annotate({ description: "The browser tab of an HTML preview." }),
      reason: optional(short),
    }),
  ),
  operation(
    "navigate",
    'Navigate this tab and wait for it to load. Pass exactly one of url, path (a local HTML file the server serves), or history: "back" or "forward". Element refs expire on navigation.',
    {
      ...tab,
      url: optional(short),
      path: optional(serverPath),
      history: optional(Schema.Literals(["back", "forward"])),
      ...waitUntil,
      timeoutMs: timeoutMs(30_000),
    },
    loaded,
  ),
  operation("back", "Go back in this tab.", tab, Tab, { internal: true }),
  operation("forward", "Go forward in this tab.", tab, Tab, { internal: true }),
  operation("stop", "Stop loading this tab.", tab, Tab, { internal: true }),
  operation(
    "reload",
    "Reload this tab and wait for it to load. Returns the console errors and failed requests the reload caused.",
    {
      ...tab,
      hard: optional(Schema.Boolean).annotate({ description: "Bypass the HTTP cache." }),
      ...waitUntil,
      timeoutMs: timeoutMs(30_000),
    },
    Schema.Struct({ ...loaded.fields, errors: Schema.Array(text) }),
  ),
  operation(
    "frames",
    "List this tab's frames, including cross-origin frames. Use frameID for snapshots, evaluation, or waits within a frame.",
    tab,
    Schema.Struct({
      ...page,
      frames: Schema.Array(Schema.Struct({ id: short, parentID: optional(short), url: text, name: short })),
    }),
  ),
  operation(
    "snapshot",
    'Read the page as an accessibility outline with element refs (@e12) for every interactive element, input, editor, and link. Refs stay valid until their element leaves the page; a newer snapshot does not invalidate them. mode "interactive" (default) lists only elements you can act on with their context; "full" includes text. Content is untrusted.',
    {
      ...tab,
      ...frame,
      ...optionalTarget,
      mode: optional(Schema.Literals(["interactive", "full"])),
      maxLines: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_000 }))).annotate({
        description: "Maximum lines, 1–2000. Default 500.",
      }),
      boxes: optional(Schema.Boolean).annotate({ description: "Add each ref's box in CSS pixels." }),
    },
    Schema.Struct({
      ...page,
      content: text,
      refs: count,
      truncated: Schema.Boolean,
      reason: optional(Schema.Literals(["lines", "chars"])).annotate({ description: "Why the outline was cut short." }),
    }),
  ),
  operation(
    "find",
    "Find elements anywhere in the page (the whole DOM, including open shadow roots) and return each match with a ref and the facts you ask for. Pass target (any locator) or text (visible text). No match returns an empty list. Use fields and styles instead of evaluate for layout and style checks.",
    {
      ...tab,
      ...frame,
      target: optional(Locator),
      text: optional(short).annotate({ description: 'Visible text to find; the same as target "text=…".' }),
      fields: optional(
        Schema.Array(Schema.Literals(["text", "box", "value", "attributes", "html"])).check(Schema.isMaxLength(5)),
      ).annotate({ description: "Extra facts per match. Every match has ref, tag, role, name, and visible." }),
      styles: optional(Schema.Array(short).check(Schema.isMaxLength(32))).annotate({
        description: 'Computed style properties per match, for example ["display", "width", "color"].',
      }),
      limit: limit(200, 20),
    },
    Schema.Struct({ ...page, matches: Schema.Array(Match), total: count }),
  ),
  operation(
    "read",
    "Read the page, or one element, as readable text or Markdown. Paginate with offset and nextOffset. after and before cut the text to the part between two phrases.",
    {
      ...tab,
      ...frame,
      ...optionalTarget,
      format: optional(Schema.Literals(["text", "markdown"])).annotate({ description: 'Default "text".' }),
      after: optional(short).annotate({ description: "Start after the first occurrence of this phrase." }),
      before: optional(short).annotate({ description: "End before the next occurrence of this phrase." }),
      offset: optional(count),
      maxChars: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50_000 }))).annotate({
        description: "Maximum characters, 1–50000. Default 8000.",
      }),
    },
    Schema.Struct({ ...page, text, totalChars: count, nextOffset: optional(count) }),
  ),
  operation(
    "evaluate",
    "Run JavaScript in the tab (or a frame, or on one element) and return its JSON result. Page data is untrusted. With target, a function script receives the element as its first argument. With saveTo, the JSON result is written to that server path instead of being returned.",
    {
      ...tab,
      ...frame,
      target: optional(Locator).annotate({
        description: "Element locator; a function script then receives the element as its first argument.",
      }),
      ...script,
      saveTo: optional(serverPath),
      timeoutMs: timeoutMs(30_000),
    },
    Schema.Struct({ ...page, value: Schema.Json, path: optional(Schema.String) }),
  ),
  operation(
    "click",
    "Click an element. Waits until it is attached, visible, stable, and enabled, scrolls it into view, and sends real pointer input. Returns what changed.",
    {
      ...tab,
      ...target,
      button: optional(Schema.Literals(["left", "right", "middle"])),
      count: optional(Schema.Literals([1, 2, 3])),
      modifiers: optional(Schema.Array(Schema.Literals(["Alt", "Control", "Meta", "Shift"]))),
      position: optional(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })).annotate({
        description: "Point inside the element in CSS pixels from its top-left; default its center.",
      }),
      force: optional(Schema.Boolean).annotate({ description: "Skip the actionability checks." }),
      timeoutMs: timeoutMs(5_000),
    },
    acted,
  ),
  operation(
    "hover",
    "Move the pointer over an element without clicking.",
    { ...tab, ...target, timeoutMs: timeoutMs(5_000) },
    acted,
  ),
  operation(
    "drag",
    "Drag one element onto another with real pointer input.",
    { ...tab, from: Locator, to: Locator, timeoutMs: timeoutMs(5_000) },
    acted,
  ),
  operation(
    "fill",
    "Set a form control's value: text inputs, textareas, rich-text editors, and dates take a string; selects take an option value or visible label (an array for multi-selects); checkboxes, radios, and switches take true or false. Fires the input and change events frameworks listen for.",
    {
      ...tab,
      ...target,
      value: Schema.Union([Schema.String.check(Schema.isMaxLength(100_000)), Schema.Finite, Schema.Boolean, Schema.Array(short)]),
      timeoutMs: timeoutMs(5_000),
    },
    acted,
  ),
  operation(
    "type",
    "Type text with real key presses into an element (focused first) or the focused element. Use it for search boxes and editors that react to keystrokes; fill is faster for plain inputs. submit presses Enter afterwards.",
    {
      ...tab,
      ...optionalTarget,
      text: Schema.String.check(Schema.isMaxLength(10_000)),
      clear: optional(Schema.Boolean).annotate({ description: "Select and delete existing text first." }),
      submit: optional(Schema.Boolean),
      delayMs: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 500 }))).annotate({
        description: "Pause between keys, 0–500. Default 0.",
      }),
      timeoutMs: timeoutMs(5_000),
    },
    acted,
  ),
  operation(
    "press",
    "Press a key or chord, for example Enter, Escape, ArrowDown, Control+A, Meta+K, Comma, or Backquote. With target the element is focused first. Fails when no element can receive the key.",
    { ...tab, key: short, ...optionalTarget, timeoutMs: timeoutMs(5_000) },
    acted,
  ),
  operation(
    "scroll",
    'Scroll the page, or a scrollable element. to "top", "bottom", "left", or "right"; by moves by CSS pixels (positive y is down). With target and neither to nor by, scrolls the element into view.',
    {
      ...tab,
      ...optionalTarget,
      to: optional(Schema.Literals(["top", "bottom", "left", "right"])),
      by: optional(Schema.Struct({ x: optional(Schema.Finite), y: optional(Schema.Finite) })),
      timeoutMs: timeoutMs(5_000),
    },
    Schema.Struct({
      ...page,
      changed: Changed,
      position: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, maxX: Schema.Finite, maxY: Schema.Finite }),
    }),
  ),
  operation(
    "dialog",
    "Inspect, accept, or dismiss an alert, confirm, or prompt in this tab. No dialog is reported as null. Actions report a dialog they opened in changed.dialog.",
    { ...tab, action: Schema.Literals(["get", "accept", "dismiss"]), promptText: optional(short) },
    Schema.Struct({
      ...page,
      dialog: Schema.NullOr(Schema.Struct({ type: short, message: text, defaultValue: short })),
    }),
  ),
  operation(
    "upload",
    "Set server-local files on a file input. Bytes are copied to the desktop; paths are never assumed shared. Maximum 25 MiB in total.",
    { ...tab, ...target, paths: Schema.Array(short).check(Schema.isMinLength(1), Schema.isMaxLength(8)) },
    acted,
  ),
  operation(
    "drop",
    "Drop server-local files onto an element, as a user dragging them from the desktop. Maximum 25 MiB in total.",
    { ...tab, ...target, paths: Schema.Array(short).check(Schema.isMinLength(1), Schema.isMaxLength(8)) },
    acted,
  ),
  operation(
    "wait",
    'Wait for a condition and report whether it was met; a timeout is a result (met: false), not an error. Pass one condition: load: true; text (visible text appears); gone (text or a locator disappears); target with optional state "visible" (default), "hidden", "attached", "detached", or "enabled"; url (a substring of the URL); script (truthy result, with args); or idle (milliseconds without network requests or DOM changes). state also applies to text. With no condition it waits timeoutMs as a plain delay: Code Mode has no timers, so this is how to pause. Survives navigation during the wait.',
    {
      ...tab,
      ...frame,
      load: optional(Schema.Literal(true)),
      text: optional(short),
      gone: optional(short).annotate({ description: "Text, or a locator such as role=dialog, that must disappear." }),
      target: optional(Locator),
      state: optional(Schema.Literals(["visible", "hidden", "attached", "detached", "enabled"])),
      url: optional(short),
      script: optional(text),
      args: script.args,
      idle: optional(Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: 30_000 }))),
      timeoutMs: timeoutMs(10_000),
      // Agents wrote `timeout` most often; an undeclared key is dropped before validation, which turned a one-second
      // pause into the ten-second default.
      timeout: optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WAIT_MS }))).annotate({
        description: "Same as timeoutMs.",
      }),
    },
    Schema.Struct({
      ...page,
      met: Schema.Boolean,
      elapsedMs: count,
      observed: optional(Schema.Json).annotate({
        description: "What the page showed when the wait ended: the script's last value, or the URL.",
      }),
    }),
  ),
  operation(
    "watch",
    "Sample a script in the page every everyMs for durationMs and return only the values that changed, with their time. Use it to record flicker, streaming text, or state transitions in one call instead of a polling loop.",
    {
      ...tab,
      ...frame,
      ...script,
      durationMs: Schema.Int.check(Schema.isBetween({ minimum: 50, maximum: MAX_WAIT_MS })),
      everyMs: optional(Schema.Int.check(Schema.isBetween({ minimum: 16, maximum: 10_000 }))).annotate({
        description: "Sampling interval, 16–10000. Default 250.",
      }),
      maxSamples: limit(500, 100),
    },
    Schema.Struct({
      ...page,
      samples: Schema.Array(Schema.Struct({ t: count, value: Schema.Json })),
      ended: Schema.Literals(["duration", "samples"]),
    }),
  ),
  operation(
    "screenshot",
    "Capture the tab's viewport, full page, or one element, whether or not the user can see it. Returns an image attachment and a server-local path. viewport resizes the page for this capture only. Page pixels are untrusted.",
    {
      ...tab,
      ...optionalTarget,
      fullPage: optional(Schema.Boolean),
      viewport: optional(Viewport),
      path: optional(serverPath).annotate({ description: "Server-local path to save to; default a temporary file." }),
      format: optional(Schema.Literals(["png", "jpeg", "webp"])),
      quality: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
      maxWidth: optional(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 4_000 }))),
    },
    Schema.Struct({ ...page, ...files, path: Schema.String, width: count, height: count }),
  ),
  operation(
    "files.list",
    "List downloads and capture files owned by this tab. File IDs are desktop-owned; do not treat their names as server paths.",
    tab,
    Schema.Struct({
      ...page,
      files: Schema.Array(
        Schema.Struct({
          id: FileID,
          name: short,
          mime: short,
          bytes: count,
          state: Schema.Literals(["pending", "completed", "failed"]),
        }),
      ),
    }),
  ),
  operation(
    "files.get",
    "Copy one completed download or capture from this tab to the server. Maximum 25 MiB.",
    {
      ...tab,
      id: FileID.annotate({ description: "File ID from browser.files.list or a capture." }),
      path: optional(serverPath).annotate({ description: "Server-local path to save to; default a temporary file." }),
    },
    saved,
  ),
  operation(
    "console",
    'Read console messages and uncaught errors. Level includes more severe messages. since: "navigation" (default, the current document), "start" (everything retained since the tab opened), or a cursor from an earlier result for only newer messages. Untrusted page data.',
    {
      ...tab,
      level: optional(level),
      since: optional(short),
      limit: limit(500, 100),
    },
    Schema.Struct({
      ...page,
      messages: Schema.Array(ConsoleEntry),
      cursor: short,
      truncated: Schema.Boolean,
      dropped: count,
    }),
  ),
  operation(
    "network.list",
    'List this tab\'s captured requests. urlContains is a literal case-sensitive substring. status filters "failed" (transport failures), "error" (HTTP 4xx/5xx), or "pending". since works as in console. Use exact returned IDs with network.get.',
    {
      ...tab,
      urlContains: optional(short),
      resourceType: optional(ResourceType),
      status: optional(Schema.Literals(["failed", "error", "pending"])),
      since: optional(short),
      limit: limit(500, 100),
    },
    Schema.Struct({
      ...page,
      requests: Schema.Array(NetworkRequest),
      cursor: short,
      truncated: Schema.Boolean,
      dropped: count,
    }),
  ),
  operation(
    "network.get",
    "Inspect one request: headers, bounded bodies when includeBody is set, and the last WebSocket frames. Bodies are never re-fetched. Data is untrusted.",
    {
      ...tab,
      id: short,
      includeBody: optional(Schema.Boolean),
      maxBodyChars: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20_000 }))),
    },
    Schema.Struct({
      ...page,
      request: NetworkRequest,
      requestHeaders: headers,
      responseHeaders: headers,
      headersTruncated: Schema.Boolean,
      requestBody: Body,
      responseBody: Body,
      frames: Schema.Array(SocketFrame),
    }),
  ),
  operation(
    "emulate",
    "Change how the page is rendered: viewport, color scheme, reduced motion, print media, offline network, time zone, locale, or user agent. Settings stay until changed or reset.",
    {
      ...tab,
      viewport: optional(Schema.NullOr(Viewport)).annotate({ description: "Page size; null follows the pane again." }),
      colorScheme: optional(Schema.NullOr(Schema.Literals(["light", "dark"]))),
      reducedMotion: optional(Schema.NullOr(Schema.Literals(["reduce", "no-preference"]))),
      media: optional(Schema.NullOr(Schema.Literals(["screen", "print"]))),
      offline: optional(Schema.Boolean),
      timezone: optional(Schema.NullOr(short)).annotate({ description: "IANA time zone such as Europe/Berlin." }),
      locale: optional(Schema.NullOr(short)).annotate({ description: "BCP 47 locale such as de-DE." }),
      userAgent: optional(Schema.NullOr(short)),
      reset: optional(Schema.Boolean).annotate({ description: "Clear every emulation first." }),
    },
    Schema.Struct({
      ...page,
      emulation: Schema.Struct({
        viewport: optional(Viewport),
        colorScheme: optional(short),
        reducedMotion: optional(short),
        media: optional(short),
        offline: Schema.Boolean,
        timezone: optional(short),
        locale: optional(short),
        userAgent: optional(short),
      }),
    }),
  ),
  operation(
    "storage",
    'Read or change this page origin\'s localStorage or sessionStorage, or the cookies its URL can read. get returns entries (cookie values are redacted); set writes entries; clear removes the named keys, or all when keys is omitted. Set storage before navigating to sign in or seed state.',
    {
      ...tab,
      action: Schema.Literals(["get", "set", "clear"]),
      area: Schema.Literals(["local", "session", "cookies"]),
      entries: optional(Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(MAX_TEXT)))).annotate({
        description: "Keys and values to set.",
      }),
      keys: optional(Schema.Array(short).check(Schema.isMaxLength(200))),
    },
    Schema.Struct({
      ...page,
      entries: Schema.Array(
        Schema.Struct({
          name: short,
          value: text,
          domain: optional(short),
          path: optional(short),
          expires: optional(Schema.Finite),
          httpOnly: optional(Schema.Boolean),
          secure: optional(Schema.Boolean),
        }),
      ),
    }),
  ),
  operation(
    "addInitScript",
    "Run a script in this tab before the page's own scripts on every later navigation, for stubs, instrumentation, or test hooks. Lasts until the tab closes.",
    { ...tab, ...script },
    Schema.Struct({ ...page, id: short }),
  ),
  operation(
    "handoff",
    "Ask the user to do something in this tab, such as signing in or solving a challenge. Shows the tab with your reason and waits until the user clicks Done (done: true) or dismisses it (done: false). Cookies stay for this session's later tabs.",
    {
      ...tab,
      reason: short.annotate({ description: "What the user should do, in one sentence." }),
      timeoutMs: timeoutMs(600_000, MAX_HANDOFF_MS),
    },
    Schema.Struct({
      ...page,
      done: Schema.Boolean,
      reason: optional(Schema.Literals(["dismissed", "timeout"])),
    }),
  ),
  operation(
    "profile.start",
    'Start a bounded recording for this tab: kind "trace" (Chromium performance trace of the renderer) or "cpu" (JavaScript sampling). Only one trace can run in the desktop app. Navigation can invalidate a CPU profile.',
    {
      ...tab,
      kind: Schema.Literals(["trace", "cpu"]),
      durationMs: optional(Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 30_000 }))),
    },
    recording,
  ),
  operation(
    "profile.stop",
    "Stop this tab's recording, copy its file to the server, and return its analysis: for a trace the event totals, long tasks, and observed timings; for a CPU profile the sampled hot functions.",
    { ...tab, limit: limit(500, 50) },
    Schema.Union([
      Schema.Struct({
        ...page,
        ...files,
        kind: Schema.Literal("trace"),
        durationMs: Schema.Finite,
        incomplete: Schema.Boolean,
        metrics,
        events: Schema.Array(Schema.Struct({ name: short, count, totalMs: Schema.Finite, maxMs: Schema.Finite })),
        insights: Schema.Array(text),
      }),
      Schema.Struct({
        ...page,
        ...files,
        kind: Schema.Literal("cpu"),
        durationMs: Schema.Finite,
        functions: Schema.Array(Schema.Struct({ name: short, url: text, line: count, selfMs: Schema.Finite })),
      }),
    ]),
  ),
  operation(
    "heap.snapshot",
    "Capture this tab's JavaScript heap, copy it to the server, and summarize it by class and shallow bytes. With compareTo (an earlier heap.snapshot file ID) it also returns per-class growth. Shallow size is not retained size; growth is not proof of a leak.",
    {
      ...tab,
      compareTo: optional(FileID),
      limit: limit(500, 50),
    },
    Schema.Struct({
      ...page,
      ...files,
      nodes: count,
      edges: count,
      selfBytes: Schema.Finite,
      classes: heapClasses,
      growth: optional(
        Schema.Array(Schema.Struct({ name: short, countDelta: Schema.Int, bytesDelta: Schema.Finite })),
      ),
    }),
  ),
  operation(
    "heap.query",
    "Find heap objects by a literal case-insensitive name substring, with bounded results ordered by shallow size.",
    {
      ...tab,
      fileID: FileID.annotate({ description: "File ID returned by heap.snapshot." }),
      name: optional(short),
      limit: limit(500, 100),
    },
    Schema.Struct({ ...page, nodes: Schema.Array(node), truncated: Schema.Boolean }),
  ),
  operation(
    "heap.object",
    "Inspect one exact object ID returned by heap.query, including bounded outgoing references and retainers. IDs belong to that snapshot.",
    {
      ...tab,
      fileID: FileID.annotate({ description: "File ID returned by heap.snapshot." }),
      id: Schema.Finite,
      limit: limit(500, 100),
    },
    Schema.Struct({
      ...page,
      node,
      references: Schema.Array(Schema.Struct({ name: text, node })),
      retainers: Schema.Array(Schema.Struct({ name: text, node })),
      truncated: Schema.Boolean,
    }),
  ),
  operation(
    "lighthouse",
    "Audit the current tab with Lighthouse for accessibility, SEO and best practices. Does not emulate a device or run a performance benchmark. Returns scores and server-local reports.",
    tab,
    Schema.Struct({
      ...page,
      ...files,
      scores: Schema.Array(Schema.Struct({ id: short, title: short, score: Schema.NullOr(Schema.Finite) })),
      failures: Schema.Array(Schema.Struct({ id: short, title: short, description: text })),
    }),
  ),
] as const

export type Operation = (typeof Operations)[number]
export type Method = Operation["name"]
export const Action = Schema.Union(Operations.map((operation) => operation.action)).annotate({
  identifier: "Browser.Action",
})
export type Action = typeof Action.Type
// Metadata only: never page content, headers, bodies, or file bytes.
export const Target = Schema.Struct({ resources: Schema.Array(text), key: text })
export type Target = typeof Target.Type
export const Command = Schema.Struct({
  action: Action,
  generation: optional(count),
  files: Schema.Array(File),
  inspect: optional(Schema.Boolean),
  target: optional(Target),
}).annotate({ identifier: "Browser.Command" })
export interface Command extends Schema.Schema.Type<typeof Command> {}
export const Result = Schema.Struct({ value: Schema.Json, files: Schema.Array(File) }).annotate({
  identifier: "Browser.Result",
})
export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Outcome = Schema.Union([
  Schema.Struct({ type: Schema.Literal("success"), result: Result }),
  Schema.Struct({ type: Schema.Literal("failure"), code: short, message: short }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Browser.Outcome" })
export type Outcome = typeof Outcome.Type
const attachment = { sessionID: Session.ID, connectionID: Schema.String }
const request = { ...attachment, requestID: Schema.String }
export const TunnelTarget = Schema.Struct({
  host: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(253), Schema.isPattern(/^[a-zA-Z0-9._:%-]+$/)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
})
export type TunnelTarget = typeof TunnelTarget.Type
const tunnel = { ...attachment, tunnelID: short }
const bytes = Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(TUNNEL_CHUNK_BYTES))
export const TunnelRead = Schema.Struct({ data: bytes, eof: Schema.Boolean })
export type TunnelRead = typeof TunnelRead.Type
const errors = { unavailable: Schema.Struct({}) }
export const Control = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attached"), connectionID: Schema.String, version: Schema.Literal(VERSION) }),
  Schema.Struct({
    type: Schema.Literal("command"),
    connectionID: Schema.String,
    requestID: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("cancel"), connectionID: Schema.String, requestID: Schema.String }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Browser.Control" })
export type Control = typeof Control.Type
export const Definition = Rpc.define({
  id: "experimental.browser",
  methods: {
    attach: {
      input: Schema.Struct({ ...attachment, version: Schema.Literal(VERSION) }),
      output: Schema.Literals(["closed", "replaced"]),
      errors,
    },
    state: { input: Schema.Struct({ ...attachment, state: State }), output: Schema.Void, errors },
    command: { input: Schema.Struct(request), output: Command, errors },
    result: { input: Schema.Struct({ ...request, outcome: Outcome }), output: Schema.Void, errors },
    "tunnel.open": { input: Schema.Struct({ ...attachment, target: TunnelTarget }), output: short, errors },
    "tunnel.read": { input: Schema.Struct(tunnel), output: TunnelRead, errors },
    "tunnel.write": {
      input: Schema.Struct({ ...tunnel, data: bytes, end: optional(Schema.Boolean) }),
      output: Schema.Void,
      errors,
    },
    "tunnel.close": { input: Schema.Struct(tunnel), output: Schema.Void, errors },
  },
  events: { control: { schema: Control } },
})

/** How long the server waits for the desktop to answer one action, beyond the action's own wait. */
export function deadline(action: Action) {
  const margin = 15_000
  if (action.type === "handoff") return (action.timeoutMs ?? 600_000) + margin
  if (action.type === "watch") return action.durationMs + margin
  if ("timeoutMs" in action) return Math.max(60_000, (action.timeoutMs ?? 0) + margin)
  if (action.type === "lighthouse" || action.type === "profile.stop" || action.type === "heap.snapshot") return 120_000
  return 60_000
}
