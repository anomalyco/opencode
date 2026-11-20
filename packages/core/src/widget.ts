export * as Widget from "./widget.js"

import { and, desc, eq, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer, Schema, Semaphore } from "effect"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Widget } from "@opencode/schema/widget"
import { builtins, program, StepError, step, validateData, version } from "@opencode/widget"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Session } from "./session.js"
import { MessageNotFoundError, NotFoundError } from "./session/error.js"
import { SessionEvent } from "./session/event.js"
import { SessionMessage } from "./session/message.js"
import type { SessionSchema } from "./session/schema.js"
import { WidgetTemplateTable } from "./widget/sql.js"

export const Name = Widget.Name
export type Name = Widget.Name

export const Version = Widget.Version
export type Version = Widget.Version

export const Ref = Widget.Ref
export type Ref = Widget.Ref

export const DataSchema = Widget.DataSchema
export type DataSchema = Widget.DataSchema

export const Summary = Widget.Summary
export type Summary = Widget.Summary

export const Template = Widget.Template
export type Template = Widget.Template

export const Program = Widget.Program
export type Program = Widget.Program

export const Response = Widget.Response
export type Response = Widget.Response

export class TemplateNotFoundError extends Schema.TaggedError<TemplateNotFoundError>()("Widget.TemplateNotFoundError", {
  name: Schema.String,
  version: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.version === undefined
      ? `Widget template not found: ${this.name}`
      : `Widget template not found: ${this.name}@${this.version}`
  }
}

/** A template that cannot be saved: a bad name, a built-in name, a broken schema, or a program that fails to run. */
export class InvalidTemplateError extends Schema.TaggedError<InvalidTemplateError>()("Widget.InvalidTemplateError", {
  name: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid widget template "${this.name}": ${this.reason}`
  }
}

/** Data that does not match the template's schema, or that makes the template's `init` step fail. */
export class InvalidDataError extends Schema.TaggedError<InvalidDataError>()("Widget.InvalidDataError", {
  name: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid data for widget template "${this.name}": ${this.reason}`
  }
}

export class AlreadyRespondedError extends Schema.TaggedError<AlreadyRespondedError>()("Widget.AlreadyRespondedError", {
  sessionID: Schema.String,
  messageID: Schema.String,
  status: Schema.Literals(["submitted", "dismissed"]),
}) {
  override get message() {
    return `Widget ${this.messageID} was already ${this.status}`
  }
}

export interface SaveInput {
  readonly name: string
  readonly description: string
  readonly data: DataSchema
  readonly source: string
  /** Data checked against `data` and run through `init` and one `view` before the template is stored. */
  readonly example: Schema.Json
}

export interface PostInput {
  readonly sessionID: SessionSchema.ID
  readonly template: Template
  readonly data: Schema.Json
  readonly title?: string
  readonly tool?: { readonly messageID: SessionMessage.ID; readonly callID: string }
}

export interface RespondInput {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly response: Response
}

export interface Interface {
  /** The latest version of every template, without sources. */
  readonly list: () => Effect.Effect<Summary[]>
  readonly latest: (name: string) => Effect.Effect<Template, TemplateNotFoundError>
  /** One immutable version, built-in or saved. */
  readonly get: (name: string, version: string) => Effect.Effect<Template, TemplateNotFoundError>
  /** Validates and stores a new version, which becomes the latest for its name. */
  readonly save: (input: SaveInput) => Effect.Effect<Template, InvalidTemplateError>
  /** Checks `data` against the template's schema and runs its `init` step once. */
  readonly check: (template: Template, data: Schema.Json) => Effect.Effect<void, InvalidDataError>
  /** Posts an open widget message into the session's history. */
  readonly post: (input: PostInput) => Effect.Effect<SessionMessage.Widget, NotFoundError>
  /**
   * Records the user's response once, then admits the model-facing prompt and wakes the session. A widget that was
   * already responded to fails with {@link AlreadyRespondedError}.
   */
  readonly respond: (
    input: RespondInput,
  ) => Effect.Effect<void, NotFoundError | MessageNotFoundError | AlreadyRespondedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Widget") {}

/** A template with its runnable program. */
export const toProgram = (template: Template): Program => ({ ...template, program: program(template.source) })

export const label = (widget: Pick<SessionMessage.Widget, "title" | "template">) => widget.title ?? widget.template.name

/** The prompt a response appends to the session. */
export const responseText = (widget: Pick<SessionMessage.Widget, "title" | "template">, response: Response) =>
  "value" in response
    ? `User responded to widget "${label(widget)}": ${JSON.stringify(response.value)}`
    : `User dismissed widget "${label(widget)}"`

const builtin = new Map(builtins.map((template) => [template.name, decodeTemplate(template)]))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    // Serializes the open-status check with the response event, so a widget is responded to once.
    const responding = Semaphore.makeUnsafe(1)

    const rows = () =>
      db
        .select()
        .from(WidgetTemplateTable)
        .where(eq(WidgetTemplateTable.builtin, false))
        .orderBy(desc(WidgetTemplateTable.time_updated))
        .all()
        .pipe(Effect.orDie)

    const store = Effect.fnUntraced(function* (template: Template, promote: boolean) {
      const now = yield* Clock.currentTimeMillis
      // Strictly after every version of this name, so the latest version is the last one stored even within one ms.
      const next = sql`max(${now}, coalesce((select max(${WidgetTemplateTable.time_updated}) from ${WidgetTemplateTable} where ${WidgetTemplateTable.name} = ${template.name}) + 1, ${now}))`
      const insert = db.insert(WidgetTemplateTable).values({
        name: template.name,
        version: template.version,
        description: template.description,
        data: template.data,
        source: template.source,
        builtin: template.builtin,
        time_created: now,
        time_updated: next,
      })
      yield* (
        promote
          ? insert.onConflictDoUpdate({
              target: [WidgetTemplateTable.name, WidgetTemplateTable.version],
              set: { description: template.description, time_updated: next },
            })
          : insert.onConflictDoNothing()
      )
        .run()
        .pipe(Effect.orDie)
    })

    const check = Effect.fn("Widget.check")(function* (template: Template, data: Schema.Json) {
      const errors = validateData(template.data, data)
      if (errors.length > 0)
        return yield* new InvalidDataError({ name: template.name, reason: errors.slice(0, 5).join("; ") })
      yield* init(template, data).pipe(
        Effect.mapError((reason) => new InvalidDataError({ name: template.name, reason })),
      )
    })

    return Service.of({
      list: Effect.fn("Widget.list")(function* () {
        const saved = (yield* rows()).filter(
          (row, index, all) => all.findIndex((item) => item.name === row.name) === index,
        )
        return [...builtin.values(), ...saved.map(fromRow)]
          .map(({ source: _, ...summary }) => summary)
          .toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      latest: Effect.fn("Widget.latest")(function* (name: string) {
        const found = builtin.get(name)
        if (found) return found
        const row = yield* db
          .select()
          .from(WidgetTemplateTable)
          .where(and(eq(WidgetTemplateTable.name, name), eq(WidgetTemplateTable.builtin, false)))
          .orderBy(desc(WidgetTemplateTable.time_updated))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new TemplateNotFoundError({ name })
        return fromRow(row)
      }),
      get: Effect.fn("Widget.get")(function* (name: string, version: string) {
        const found = builtin.get(name)
        if (found?.version === version) return found
        const row = yield* db
          .select()
          .from(WidgetTemplateTable)
          .where(and(eq(WidgetTemplateTable.name, name), eq(WidgetTemplateTable.version, version)))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new TemplateNotFoundError({ name, version })
        return fromRow(row)
      }),
      save: Effect.fn("Widget.save")(function* (input: SaveInput) {
        const invalid = (reason: string) => new InvalidTemplateError({ name: input.name, reason })
        if (!Schema.is(Name)(input.name))
          return yield* invalid("names are lowercase letters, digits and dashes, starting with a letter, at most 48")
        if (builtin.has(input.name)) return yield* invalid("built-in templates cannot be overwritten")
        if (input.description.trim() === "") return yield* invalid("description is empty")
        if (input.data.type !== "object") return yield* invalid('the data schema must have type "object"')
        const template = decodeTemplate({
          name: input.name,
          version: version(input.source, input.data),
          description: input.description.trim(),
          data: input.data,
          source: input.source,
          builtin: false,
        })
        yield* check(template, input.example).pipe(Effect.mapError((error) => invalid(`example: ${error.reason}`)))
        yield* store(template, true)
        return template
      }),
      check,
      post: Effect.fn("Widget.post")(function* (input: PostInput) {
        yield* sessions.get(input.sessionID)
        // Built-ins change with releases; keep every version a message refers to so it keeps rendering.
        if (input.template.builtin) yield* store(input.template, false)
        const messageID = SessionMessage.ID.create()
        const event = yield* bus.publish(SessionEvent.Widget.Posted, {
          sessionID: input.sessionID,
          messageID,
          title: input.title,
          template: { name: input.template.name, version: input.template.version },
          data: input.data,
          tool: input.tool,
        })
        return SessionMessage.Widget.make({
          id: messageID,
          type: "widget",
          title: input.title,
          template: event.data.template,
          data: input.data,
          tool: input.tool,
          status: "open",
          time: { created: DateTime.makeUnsafe(event.created) },
        })
      }),
      respond: Effect.fn("Widget.respond")(function* (input: RespondInput) {
        yield* sessions.get(input.sessionID)
        const widget = yield* Effect.gen(function* () {
          const message = yield* sessions.message({ sessionID: input.sessionID, messageID: input.messageID })
          if (message?.type !== "widget")
            return yield* new MessageNotFoundError({ sessionID: input.sessionID, messageID: input.messageID })
          if (message.status !== "open")
            return yield* new AlreadyRespondedError({
              sessionID: input.sessionID,
              messageID: input.messageID,
              status: message.status,
            })
          yield* bus.publish(SessionEvent.Widget.Responded, {
            sessionID: input.sessionID,
            messageID: input.messageID,
            ...("value" in input.response
              ? { status: "submitted" as const, response: input.response.value }
              : { status: "dismissed" as const }),
          })
          return message
        }).pipe(Semaphore.withPermit(responding))
        yield* sessions
          .synthetic({
            sessionID: input.sessionID,
            text: responseText(widget, input.response),
            description: "value" in input.response ? `Responded to "${label(widget)}"` : `Dismissed "${label(widget)}"`,
            metadata: { widget: { messageID: input.messageID } },
          })
          .pipe(Effect.catchTag("Session.SyntheticConflictError", Effect.die))
      }),
    })
  }),
)

// Annotated: inferring it would cycle through Session and the internal plugins that capture this service.
export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, Session.node],
})

function decodeTemplate(template: unknown): Template {
  return Schema.decodeUnknownSync(Template)(template)
}

function fromRow(row: typeof WidgetTemplateTable.$inferSelect): Template {
  return {
    name: row.name,
    version: row.version,
    description: row.description,
    data: row.data,
    source: row.source,
    builtin: row.builtin,
  }
}

/** Runs the `init` step, which also renders the first view, and returns the failure message. */
function init(template: Template, data: Schema.Json) {
  return Effect.tryPromise({
    try: () => step(program(template.source), { phase: "init", data }),
    catch: (error) => (error instanceof StepError ? `${error.kind}: ${error.message}` : String(error)),
  }).pipe(Effect.asVoid)
}
