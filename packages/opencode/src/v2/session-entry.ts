import { Schema } from "effect"
import { SessionEvent } from "./session-event"
import { castDraft, produce } from "immer"

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
}) {}

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

export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool]).pipe(
  Schema.toTaggedUnion("type"),
)
export type AssistantContent = Schema.Schema.Type<typeof AssistantContent>

export class Assistant extends Schema.Class<Assistant>("Session.Entry.Assistant")({
  ...Base,
  type: Schema.Literal("assistant"),
  content: AssistantContent.pipe(Schema.Array),
  cost: Schema.Number.pipe(Schema.optional),
  tokens: Schema.Struct({
    input: Schema.Number,
    output: Schema.Number,
    reasoning: Schema.Number,
    cache: Schema.Struct({
      read: Schema.Number,
      write: Schema.Number,
    }),
  }).pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
  time: Schema.Struct({
    created: Schema.DateTimeUtc,
    completed: Schema.DateTimeUtc.pipe(Schema.optional),
  }),
}) {}

export class Compaction extends Schema.Class<Compaction>("Session.Entry.Compaction")({
  ...SessionEvent.Compacted.fields,
  type: Schema.Literal("compaction"),
  ...Base,
}) {}

export const Entry = Schema.Union([User, Synthetic, Assistant, Compaction]).pipe(Schema.toTaggedUnion("type"))

export type Entry = Schema.Schema.Type<typeof Entry>

export type Type = Entry["type"]

export type History = {
  entries: Entry[]
  pending: Entry[]
}

export function step(old: History, event: SessionEvent.Event): History {
  return produce(old, (draft) => {
    const lastAssistant = draft.entries.findLast((x) => x.type === "assistant")
    const pendingAssistant = lastAssistant && !lastAssistant.time.completed ? lastAssistant : undefined
    type DraftContent = NonNullable<typeof pendingAssistant>["content"][number]
    type DraftTool = Extract<DraftContent, { type: "tool" }>

    const latestTool = (callID?: string) =>
      pendingAssistant?.content.findLast(
        (item): item is DraftTool => item.type === "tool" && (callID === undefined || item.callID === callID),
      )
    const latestText = () => pendingAssistant?.content.findLast((item) => item.type === "text")
    const latestReasoning = () => pendingAssistant?.content.findLast((item) => item.type === "reasoning")

    SessionEvent.Event.match(event, {
      prompt: (event) => {
        const entry = User.fromEvent(event)
        if (pendingAssistant) {
          draft.pending.push(castDraft(entry))
          return
        }
        draft.entries.push(castDraft(entry))
      },
      synthetic: (event) => {
        draft.entries.push(new Synthetic({ ...event, time: { created: event.timestamp } }))
      },
      "step.started": (event) => {
        if (pendingAssistant) pendingAssistant.time.completed = event.timestamp
        draft.entries.push({
          id: event.id,
          type: "assistant",
          time: {
            created: event.timestamp,
          },
          content: [],
        })
      },
      "step.ended": (event) => {
        if (!pendingAssistant) return
        pendingAssistant.time.completed = event.timestamp
        pendingAssistant.cost = event.cost
        pendingAssistant.tokens = event.tokens
      },
      "text.started": () => {
        if (!pendingAssistant) return
        pendingAssistant.content.push({
          type: "text",
          text: "",
        })
      },
      "text.delta": (event) => {
        if (!pendingAssistant) return
        const match = latestText()
        if (match) match.text += event.delta
      },
      "text.ended": () => {},
      "tool.input.started": (event) => {
        if (!pendingAssistant) return
        pendingAssistant.content.push({
          type: "tool",
          callID: event.callID,
          name: event.name,
          time: {
            created: event.timestamp,
          },
          state: {
            status: "pending",
            input: "",
          },
        })
      },
      "tool.input.delta": (event) => {
        if (!pendingAssistant) return
        const match = latestTool(event.callID)
        // oxlint-disable-next-line no-base-to-string -- event.delta is a Schema.String (runtime string)
        if (match) match.state.input += event.delta
      },
      "tool.input.ended": () => {},
      "tool.called": (event) => {
        if (!pendingAssistant) return
        const match = latestTool(event.callID)
        if (match) {
          match.time.ran = event.timestamp
          match.state = {
            status: "running",
            input: event.input,
          }
        }
      },
      "tool.success": (event) => {
        if (!pendingAssistant) return
        const match = latestTool(event.callID)
        if (match && match.state.status === "running") {
          match.state = {
            status: "completed",
            input: match.state.input,
            output: event.output ?? "",
            title: event.title,
            metadata: event.metadata ?? {},
            attachments: [...(event.attachments ?? [])],
          }
        }
      },
      "tool.error": (event) => {
        if (!pendingAssistant) return
        const match = latestTool(event.callID)
        if (match && match.state.status === "running") {
          match.state = {
            status: "error",
            error: event.error,
            input: match.state.input,
            metadata: event.metadata ?? {},
          }
        }
      },
      "reasoning.started": () => {
        if (!pendingAssistant) return
        pendingAssistant.content.push({
          type: "reasoning",
          text: "",
        })
      },
      "reasoning.delta": (event) => {
        if (!pendingAssistant) return
        const match = latestReasoning()
        if (match) match.text += event.delta
      },
      "reasoning.ended": (event) => {
        if (!pendingAssistant) return
        const match = latestReasoning()
        if (match) match.text = event.text
      },
      retried: () => {},
      compacted: (event) => {
        draft.entries.push(new Compaction({ ...event, type: "compaction", time: { created: event.timestamp } }))
      },
    })
  })
}

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
