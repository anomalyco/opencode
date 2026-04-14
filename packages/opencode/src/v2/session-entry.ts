import { Identifier } from "@/id/id"
import { Database } from "@/node"
import type { SessionID } from "@/session/schema"
import { SessionEntryTable } from "@/session/session.sql"
import { withStatics } from "@/util/schema"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { eq } from "../storage/db"

export namespace SessionEntry {
  export const ID = Schema.String.pipe(Schema.brand("Session.Entry.ID")).pipe(
    withStatics((s) => ({
      create: () => s.make(Identifier.ascending("entry")),
      prefix: "ent",
    })),
  )
  export type ID = Schema.Schema.Type<typeof ID>

  const Base = {
    id: ID,
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
  }

  export class Source extends Schema.Class<Source>("Session.Entry.Source")({
    start: Schema.Number,
    end: Schema.Number,
    text: Schema.String,
  }) {}

  export class FileAttachment extends Schema.Class<FileAttachment>("Session.Entry.File.Attachment")({
    uri: Schema.String,
    mime: Schema.String,
    name: Schema.String.pipe(Schema.optional),
    description: Schema.String.pipe(Schema.optional),
    source: Source.pipe(Schema.optional),
  }) {
    static create(url: string) {
      return new FileAttachment({
        uri: url,
        mime: "text/plain",
      })
    }
  }

  export class AgentAttachment extends Schema.Class<AgentAttachment>("Session.Entry.Agent.Attachment")({
    name: Schema.String,
    source: Source.pipe(Schema.optional),
  }) {}

  export class User extends Schema.Class<User>("Session.Entry.User")({
    ...Base,
    type: Schema.Literal("user"),
    text: Schema.String,
    files: Schema.Array(FileAttachment).pipe(Schema.optional),
    agents: Schema.Array(AgentAttachment).pipe(Schema.optional),
  }) {
    static create(input: { text: User["text"]; files?: User["files"]; agents?: User["agents"] }) {
      const msg = new User({
        id: ID.create(),
        type: "user",
        ...input,
        time: {
          created: Effect.runSync(DateTime.now),
        },
      })
      return msg
    }
  }

  export class Synthetic extends Schema.Class<Synthetic>("Session.Entry.Synthetic")({
    ...Base,
    type: Schema.Literal("synthetic"),
    text: Schema.String,
  }) {}

  export class Request extends Schema.Class<Request>("Session.Entry.Request")({
    ...Base,
    type: Schema.Literal("start"),
    model: Schema.Struct({
      id: Schema.String,
      providerID: Schema.String,
      variant: Schema.String.pipe(Schema.optional),
    }),
  }) {}

  export class Text extends Schema.Class<Text>("Session.Entry.Text")({
    ...Base,
    type: Schema.Literal("text"),
    text: Schema.String,
    time: Schema.Struct({
      ...Base.time.fields,
      completed: Schema.DateTimeUtc.pipe(Schema.optional),
    }),
  }) {}

  export class Reasoning extends Schema.Class<Reasoning>("Session.Entry.Reasoning")({
    ...Base,
    type: Schema.Literal("reasoning"),
    text: Schema.String,
    time: Schema.Struct({
      ...Base.time.fields,
      completed: Schema.DateTimeUtc.pipe(Schema.optional),
    }),
  }) {}

  export class ToolStatePending extends Schema.Class<ToolStatePending>("Session.Entry.ToolState.Pending")({
    status: Schema.Literal("pending"),
    input: Schema.Record(Schema.String, Schema.Unknown),
    raw: Schema.String,
  }) {}

  export class ToolStateRunning extends Schema.Class<ToolStateRunning>("Session.Entry.ToolState.Running")({
    status: Schema.Literal("running"),
    input: Schema.Record(Schema.String, Schema.Unknown),
    title: Schema.String.pipe(Schema.optional),
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  }) {}

  export class ToolStateCompleted extends Schema.Class<ToolStateCompleted>("Session.Entry.ToolState.Completed")({
    status: Schema.Literal("completed"),
    input: Schema.Record(Schema.String, Schema.Unknown),
    output: Schema.String,
    title: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.Unknown),
    attachments: Schema.Array(FileAttachment).pipe(Schema.optional),
  }) {}

  export class ToolStateError extends Schema.Class<ToolStateError>("Session.Entry.ToolState.Error")({
    status: Schema.Literal("error"),
    input: Schema.Record(Schema.String, Schema.Unknown),
    error: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
    time: Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
    }),
  }) {}

  export const ToolState = Schema.Union([ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
  export type ToolState = Schema.Schema.Type<typeof ToolState>

  export class Tool extends Schema.Class<Tool>("Session.Entry.Tool")({
    ...Base,
    type: Schema.Literal("tool"),
    callID: Schema.String,
    name: Schema.String,
    state: ToolState,
    time: Schema.Struct({
      ...Base.time.fields,
      ran: Schema.DateTimeUtc.pipe(Schema.optional),
      completed: Schema.DateTimeUtc.pipe(Schema.optional),
      pruned: Schema.DateTimeUtc.pipe(Schema.optional),
    }),
  }) {}

  export class Complete extends Schema.Class<Complete>("Session.Entry.Complete")({
    ...Base,
    type: Schema.Literal("complete"),
    cost: Schema.Number,
    reason: Schema.String,
    tokens: Schema.Struct({
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cache: Schema.Struct({
        read: Schema.Number,
        write: Schema.Number,
      }),
    }),
  }) {}

  export class Retry extends Schema.Class<Retry>("Session.Entry.Retry")({
    ...Base,
    type: Schema.Literal("retry"),
    attempt: Schema.Number,
    error: Schema.String,
  }) {}

  export class Compaction extends Schema.Class<Compaction>("Session.Entry.Compaction")({
    ...Base,
    type: Schema.Literal("compaction"),
    auto: Schema.Boolean,
    overflow: Schema.Boolean.pipe(Schema.optional),
  }) {}

  export const Entry = Schema.Union([User, Synthetic, Request, Tool, Text, Reasoning, Complete, Retry, Compaction], {
    mode: "oneOf",
  })
  export type Entry = Schema.Schema.Type<typeof Entry>

  export type Type = Entry["type"]

  export interface Interface {
    readonly decode: (row: typeof SessionEntryTable.$inferSelect) => Entry
    readonly fromSession: (sessionID: SessionID) => Effect.Effect<Entry[], never>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SessionEntry") {}

  export const layer: Layer.Layer<Service, never, never> = Layer.effect(
    Service,
    Effect.gen(function* () {
      const decodeEntry = Schema.decodeUnknownSync(Entry)

      const decode: (typeof Service.Service)["decode"] = (row) => decodeEntry({ ...row, id: row.id, type: row.type })

      const fromSession = Effect.fn("SessionEntry.fromSession")(function* (sessionID: SessionID) {
        return Database.use((db) =>
          db
            .select()
            .from(SessionEntryTable)
            .where(eq(SessionEntryTable.session_id, sessionID))
            .orderBy(SessionEntryTable.id)
            .all()
            .map((row) => decode(row)),
        )
      })

      return Service.of({
        decode,
        fromSession,
      })
    }),
  )
}
