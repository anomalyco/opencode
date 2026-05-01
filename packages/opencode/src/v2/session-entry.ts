import { Schema } from "effect"
import { NonNegativeInt } from "@/util/schema"
import { SessionEvent } from "./session-event"

export const ID = SessionEvent.ID
export type ID = Schema.Schema.Type<typeof ID>

const Base = {
  id: SessionEvent.ID,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
  }),
}

export class User extends Schema.Class<User>("Session.Entry.User")({
  ...Base,
  text: SessionEvent.Prompt.fields.text,
  files: SessionEvent.Prompt.fields.files,
  agents: SessionEvent.Prompt.fields.agents,
  type: Schema.Literal("user"),
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
  }),
}) {
  static fromEvent(event: SessionEvent.Prompt) {
    return new User({
      id: event.id,
      type: "user",
      metadata: event.metadata,
      text: event.text,
      files: event.files,
      agents: event.agents,
      time: { created: event.timestamp },
    })
  }
}

export class Synthetic extends Schema.Class<Synthetic>("Session.Entry.Synthetic")({
  ...SessionEvent.Synthetic.fields,
  ...Base,
  type: Schema.Literal("synthetic"),
}) {
  static fromEvent(event: SessionEvent.Synthetic) {
    return new Synthetic({
      ...event,
      time: { created: event.timestamp },
    })
  }
}

export class ToolStatePending extends Schema.Class<ToolStatePending>("Session.Entry.ToolState.Pending")({
  status: Schema.Literal("pending"),
  input: Schema.String,
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
  attachments: SessionEvent.FileAttachment.pipe(Schema.Array, Schema.optional),
}) {}

export class ToolStateError extends Schema.Class<ToolStateError>("Session.Entry.ToolState.Error")({
  status: Schema.Literal("error"),
  input: Schema.Record(Schema.String, Schema.Unknown),
  error: Schema.String,
  metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
}) {}

export const ToolState = Schema.Union([ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError]).pipe(
  Schema.toTaggedUnion("status"),
)
export type ToolState = Schema.Schema.Type<typeof ToolState>

export class AssistantTool extends Schema.Class<AssistantTool>("Session.Entry.Assistant.Tool")({
  type: Schema.Literal("tool"),
  callID: Schema.String,
  name: Schema.String,
  state: ToolState,
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
    ran: Schema.DateTimeUtc.pipe(Schema.optional),
    completed: Schema.DateTimeUtc.pipe(Schema.optional),
    pruned: Schema.DateTimeUtc.pipe(Schema.optional),
  }),
}) {}

export class AssistantText extends Schema.Class<AssistantText>("Session.Entry.Assistant.Text")({
  type: Schema.Literal("text"),
  text: Schema.String,
}) {}

export class AssistantReasoning extends Schema.Class<AssistantReasoning>("Session.Entry.Assistant.Reasoning")({
  type: Schema.Literal("reasoning"),
  text: Schema.String,
}) {}

export class AssistantRetry extends Schema.Class<AssistantRetry>("Session.Entry.Assistant.Retry")({
  attempt: NonNegativeInt,
  error: SessionEvent.RetryError,
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
  }),
}) {
  static fromEvent(event: SessionEvent.Retried) {
    return new AssistantRetry({
      attempt: event.attempt,
      error: event.error,
      time: {
        created: event.timestamp,
      },
    })
  }
}

export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool]).pipe(
  Schema.toTaggedUnion("type"),
)
export type AssistantContent = Schema.Schema.Type<typeof AssistantContent>

export class Assistant extends Schema.Class<Assistant>("Session.Entry.Assistant")({
  ...Base,
  type: Schema.Literal("assistant"),
  content: AssistantContent.pipe(Schema.Array),
  retries: AssistantRetry.pipe(Schema.Array, Schema.optional),
  cost: Schema.Finite.pipe(Schema.optional),
  tokens: Schema.Struct({
    input: NonNegativeInt,
    output: NonNegativeInt,
    reasoning: NonNegativeInt,
    cache: Schema.Struct({
      read: NonNegativeInt,
      write: NonNegativeInt,
    }),
  }).pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
    completed: Schema.DateTimeUtc.pipe(Schema.optional),
  }),
}) {
  static fromEvent(event: SessionEvent.Step.Started) {
    return new Assistant({
      id: event.id,
      type: "assistant",
      time: {
        created: event.timestamp,
      },
      content: [],
      retries: [],
    })
  }
}

export class Compaction extends Schema.Class<Compaction>("Session.Entry.Compaction")({
  ...SessionEvent.Compacted.fields,
  type: Schema.Literal("compaction"),
  ...Base,
}) {
  static fromEvent(event: SessionEvent.Compacted) {
    return new Compaction({
      ...event,
      type: "compaction",
      time: { created: event.timestamp },
    })
  }
}

export const Entry = Schema.Union([User, Synthetic, Assistant, Compaction]).pipe(Schema.toTaggedUnion("type"))

export type Entry = Schema.Schema.Type<typeof Entry>

export type Type = Entry["type"]

/*
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
*/

export * as SessionEntry from "./session-entry"
