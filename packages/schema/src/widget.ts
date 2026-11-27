export * as Widget from "./widget.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/** A widget template name, unique per server. */
export const Name = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,47}$/)).annotate({
  identifier: "Widget.Name",
})
export type Name = typeof Name.Type

/** The first 16 hex characters of `sha256(program + "\n" + JSON.stringify(data))`: a content address. */
export const Version = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)).annotate({
  identifier: "Widget.Version",
})
export type Version = typeof Version.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({
  name: Name,
  version: Version,
}).annotate({ identifier: "Widget.Ref" })

/** A JSON Schema (draft 2020-12 subset) describing the data a widget template takes. */
export const DataSchema = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "Widget.DataSchema" })
export type DataSchema = typeof DataSchema.Type

/** How clients run a widget template: short `init`/`view`/`draw` steps with handlers on nodes, or one long-running `main` (widgets-live.md). */
export const Mode = Schema.Literals(["step", "live"]).annotate({ identifier: "Widget.Mode" })
export type Mode = typeof Mode.Type

/**
 * What a live widget template may use beyond rendering (widgets-live.md, Capabilities). `https.hosts` entries are exact host
 * names or `*.` suffix wildcards; `["*"]` is any host. `storage: {}` gives it `widget.storage`, one space per widget
 * template name on its server (widgets-live.md, Storage).
 */
export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  https: optional(Schema.Struct({ hosts: Schema.Array(Schema.String) })),
  storage: optional(Schema.Struct({})),
}).annotate({ identifier: "Widget.Capabilities" })

/** A widget template version without its source, as listed. */
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  name: Name,
  version: Version,
  /** One line, shown to the model when listing widget templates. */
  description: Schema.String,
  data: DataSchema,
  mode: Mode,
  /** Live widget templates only. */
  capabilities: optional(Capabilities),
  builtin: Schema.Boolean,
}).annotate({ identifier: "Widget.Summary" })

export interface WidgetTemplate extends Schema.Schema.Type<typeof WidgetTemplate> {}
export const WidgetTemplate = Schema.Struct({
  ...Summary.fields,
  /** The widget template's PsychoScript source. */
  source: Schema.String,
}).annotate({ identifier: "Widget.WidgetTemplate" })

/** A widget template with its runnable program: the widget prelude followed by the source. */
export interface Program extends Schema.Schema.Type<typeof Program> {}
export const Program = Schema.Struct({
  ...WidgetTemplate.fields,
  program: Schema.String,
}).annotate({ identifier: "Widget.Program" })

/** `superseded`: a newer widget replaced it (`replaces`); it can't be answered, and clients show "Updated below". */
export const Status = Schema.Literals(["open", "submitted", "dismissed", "superseded"]).annotate({
  identifier: "Widget.Status",
})
export type Status = typeof Status.Type

export interface Submit extends Schema.Schema.Type<typeof Submit> {}
export const Submit = Schema.Struct({ value: Schema.Json }).annotate({ identifier: "Widget.Submit" })

export interface Dismiss extends Schema.Schema.Type<typeof Dismiss> {}
export const Dismiss = Schema.Struct({ dismiss: Schema.Literal(true) }).annotate({ identifier: "Widget.Dismiss" })

/** A response to an open widget: the submitted value, or a dismissal. */
export const Response = Schema.Union([Submit, Dismiss]).annotate({ identifier: "Widget.Response" })
export type Response = Submit | Dismiss

/**
 * A program error a client hit running the widget (widgets.md, Failures): the widget template's own code failed or broke a
 * contract. `phase` is open: clients may report others.
 */
export interface RuntimeError extends Schema.Schema.Type<typeof RuntimeError> {}
export const RuntimeError = Schema.Struct({
  phase: Schema.String.annotate({
    description: '"init", "event" (a handler or hook), "view", "draw", "main", "shader", "fetch" or another',
  }),
  message: Schema.String,
  /** 1-based, in the widget template's source. */
  line: optional(Schema.Number),
  column: optional(Schema.Number),
}).annotate({ identifier: "Widget.RuntimeError" })

/** A widget's recorded program error. `sent`: the agent has been told (automatically, or through `ask`). */
export interface Failure extends Schema.Schema.Type<typeof Failure> {}
export const Failure = Schema.Struct({
  ...RuntimeError.fields,
  /** The client that reported it: `tui`, `rune`, `ios`, `android`, `web`. */
  client: Schema.String,
  sent: Schema.Boolean,
}).annotate({ identifier: "Widget.Failure" })

/**
 * One widget: a `widget` tool call in a Session's history plus its answer. `messageID` is the assistant message that
 * holds the call; a call ID is unique only within its message.
 */
export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  sessionID: Schema.String,
  messageID: Schema.String,
  callID: Schema.String,
  widgetTemplate: Ref,
  title: optional(Schema.String),
  status: Status,
  /** The submitted value; absent while open and for a dismissal. */
  response: optional(Schema.Json),
  /** The tool call waits for the answer and returns it as its result. */
  wait: Schema.Boolean,
  /** The widget template's capabilities, so clients can show what the widget is granted. */
  capabilities: optional(Capabilities),
  /** The program error its last report recorded; the widget keeps its status. */
  failure: optional(Failure),
  /** The widget that replaced this one, when `status` is `superseded`. */
  supersededBy: optional(Schema.Struct({ messageID: Schema.String, callID: Schema.String })),
  /** Epoch milliseconds. */
  time: Schema.Struct({ created: Schema.Number, responded: optional(Schema.Number) }),
}).annotate({ identifier: "Widget.State" })

const Call = { sessionID: Schema.String, messageID: Schema.String, callID: Schema.String }
const standard = Schema.toStandardSchemaV1
const NotFound = standard(Schema.Struct({}))
const Closed = standard(Schema.Struct({ status: Schema.Literals(["submitted", "dismissed", "superseded"]) }))

/**
 * The widgets plugin's RPC. Clients list a Session's widgets with `states`, keep them current from `changed`, fetch a
 * widget template's program once per `name@version` with `program`, and answer with `respond` or `send`. Calls go to the
 * Session's Location. The schemas are Standard Schemas, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "opencode.widget",
  methods: {
    /** The latest version of every widget template, without sources. */
    widgetTemplates: { input: standard(Schema.Struct({})), output: standard(Schema.Array(Summary)) },
    /** One immutable widget template version with its program; the latest when `version` is omitted. */
    program: {
      input: standard(Schema.Struct({ name: Schema.String, version: optional(Schema.String) })),
      output: standard(Program),
      errors: { not_found: NotFound },
    },
    /** Every widget of a Session, oldest first. */
    states: { input: standard(Schema.Struct({ sessionID: Schema.String })), output: standard(Schema.Array(State)) },
    /** The final answer, once: a submitted value or a dismissal. */
    respond: {
      input: standard(Schema.Struct({ ...Call, response: Response })),
      output: standard(State),
      errors: { not_found: NotFound, closed: Closed },
    },
    /** A message to the agent while the widget stays open; `wake` (default true) starts a turn. */
    send: {
      input: standard(Schema.Struct({ ...Call, value: Schema.Json, wake: optional(Schema.Boolean) })),
      output: standard(State),
      errors: { not_found: NotFound, closed: Closed, rate_limited: NotFound },
    },
    /**
     * A program error a client hit running the widget (never a client error; widgets.md, Failures). It is recorded as
     * the widget's `failure`, and sent to the agent automatically only when the widget's Session created the widget template
     * version (`failure.sent`); `ask: true` sends it once otherwise (the user's "Ask agent to fix it"). Automatic sends
     * drop repeats and go out at most once per widget every 10 seconds. A closed widget ignores reports.
     */
    report: {
      input: standard(
        Schema.Struct({ ...Call, error: RuntimeError, client: Schema.String, ask: optional(Schema.Boolean) }),
      ),
      output: standard(State),
      errors: { not_found: NotFound },
    },
  },
  events: {
    changed: { schema: standard(Schema.Struct({ sessionID: Schema.String, state: State })) },
  },
})
