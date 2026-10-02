import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { Remote } from "../sdk"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))
const detail = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
const binding = text(128)

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

export const PaneEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({ type: Schema.Literal("preview"), path: text(2_048) }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
  // A tab's page exists; the renderer lays it out through this host surface.
  Schema.Struct({ type: Schema.Literal("surface"), tabID: Browser.TabID, surface: text(256) }),
  // The page's element picker started, stopped, or picked an element.
  Schema.Struct({
    type: Schema.Literal("inspect"),
    tabID: Browser.TabID,
    active: Schema.Boolean,
    element: Schema.optionalKey(PaneElement),
  }),
])
export type PaneEvent = typeof PaneEvent.Type

/**
 * The native browser pane in the main process. A binding is one registration of a session's pane
 * by a window; its events go to that window only.
 */
export const BrowserPane = Remote.define({
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
    // Starts or stops the page's element picker; the page reports picks and exits as inspect events.
    inspect: { input: Schema.Struct({ binding, tabID: Browser.TabID, enabled: Schema.Boolean }) },
    // Highlights a picked element briefly, or clears any highlight when ref is omitted.
    highlight: { input: Schema.Struct({ binding, tabID: Browser.TabID, ref: Schema.optionalKey(Browser.Ref) }) },
    close: { input: Schema.Struct({ binding }) },
  },
  events: {
    event: Schema.Struct({ binding: Schema.String, event: PaneEvent }),
  },
})
