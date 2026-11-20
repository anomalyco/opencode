export * as Widget from "./widget.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional } from "./schema.js"

/** A template name, unique per server. */
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

/** A JSON Schema (draft 2020-12 subset) describing the data a template takes. */
export const DataSchema = Schema.Record(Schema.String, Schema.Json).annotate({ identifier: "Widget.DataSchema" })
export type DataSchema = typeof DataSchema.Type

/** How clients run a template: short `init`/`update`/`view`/`draw` steps, or one long-running `main` (widgets-live.md). */
export const Mode = Schema.Literals(["step", "live"]).annotate({ identifier: "Widget.Mode" })
export type Mode = typeof Mode.Type

/**
 * What a live template may use beyond rendering (widgets-live.md, Capabilities). `https.hosts` entries are exact host
 * names or `*.` suffix wildcards; `["*"]` is any host.
 */
export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  https: optional(Schema.Struct({ hosts: Schema.Array(Schema.String) })),
}).annotate({ identifier: "Widget.Capabilities" })

/** A template version without its source, as listed. */
export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  name: Name,
  version: Version,
  /** One line, shown to the model when listing templates. */
  description: Schema.String,
  data: DataSchema,
  mode: Mode,
  /** Live templates only. */
  capabilities: optional(Capabilities),
  /** Offer full screen always (`true`), never (`false`), or, when absent, for live and canvas/shader views. */
  fullscreen: optional(Schema.Boolean),
  builtin: Schema.Boolean,
}).annotate({ identifier: "Widget.Summary" })

export interface Template extends Schema.Schema.Type<typeof Template> {}
export const Template = Schema.Struct({
  ...Summary.fields,
  /** The template's PsychoScript source. */
  source: Schema.String,
}).annotate({ identifier: "Widget.Template" })

/** A template with its runnable program: the widget prelude followed by the source. */
export interface Program extends Schema.Schema.Type<typeof Program> {}
export const Program = Schema.Struct({
  ...Template.fields,
  program: Schema.String,
}).annotate({ identifier: "Widget.Program" })

export const Status = Schema.Literals(["open", "submitted", "dismissed"]).annotate({ identifier: "Widget.Status" })
export type Status = typeof Status.Type

export interface Submit extends Schema.Schema.Type<typeof Submit> {}
export const Submit = Schema.Struct({ value: Schema.Json }).annotate({ identifier: "Widget.Submit" })

export interface Dismiss extends Schema.Schema.Type<typeof Dismiss> {}
export const Dismiss = Schema.Struct({ dismiss: Schema.Literal(true) }).annotate({ identifier: "Widget.Dismiss" })

/** A response to an open widget: the submitted value, or a dismissal. */
export const Response = Schema.Union([Submit, Dismiss]).annotate({ identifier: "Widget.Response" })
export type Response = Submit | Dismiss

/**
 * One widget: a `widget` tool call in a Session's history plus its answer. `messageID` is the assistant message that
 * holds the call; a call ID is unique only within its message.
 */
export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  sessionID: Schema.String,
  messageID: Schema.String,
  callID: Schema.String,
  template: Ref,
  title: optional(Schema.String),
  status: Status,
  /** The submitted value; absent while open and for a dismissal. */
  response: optional(Schema.Json),
  /** The tool call waits for the answer and returns it as its result. */
  wait: Schema.Boolean,
  /** The template's capabilities, so clients can show what the widget is granted. */
  capabilities: optional(Capabilities),
  /** The template's `fullscreen` choice (widgets-fullscreen.md). */
  fullscreen: optional(Schema.Boolean),
  /** Epoch milliseconds. */
  time: Schema.Struct({ created: Schema.Number, responded: optional(Schema.Number) }),
}).annotate({ identifier: "Widget.State" })

const Call = { sessionID: Schema.String, messageID: Schema.String, callID: Schema.String }
const standard = Schema.toStandardSchemaV1
const NotFound = standard(Schema.Struct({}))
const Closed = standard(Schema.Struct({ status: Schema.Literals(["submitted", "dismissed"]) }))

/**
 * The widgets plugin's RPC. Clients list a Session's widgets with `states`, keep them current from `changed`, fetch a
 * template's program once per `name@version` with `program`, and answer with `respond` or `send`. Calls go to the
 * Session's Location. The schemas are Standard Schemas, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "opencode.widget",
  methods: {
    /** The latest version of every template, without sources. */
    templates: { input: standard(Schema.Struct({})), output: standard(Schema.Array(Summary)) },
    /** One immutable template version with its program; the latest when `version` is omitted. */
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
  },
  events: {
    changed: { schema: standard(Schema.Struct({ sessionID: Schema.String, state: State })) },
  },
})
