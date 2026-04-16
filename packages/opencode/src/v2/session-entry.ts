import { Schema } from "effect"
import { SessionEvent } from "./session-event"
import { produce } from "immer"

export namespace SessionEntry {
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

  export const ToolState = Schema.Union([ToolStatePending, ToolStateRunning, ToolStateCompleted, ToolStateError])
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

  export const AssistantContent = Schema.Union([AssistantText, AssistantReasoning, AssistantTool])
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

  export const Entry = Schema.Union([User, Synthetic, Assistant, Compaction])

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

      switch (event.type) {
        case "prompt": {
          if (pendingAssistant) {
            // @ts-expect-error
            draft.pending.push(User.fromEvent(event))
            break
          }
          // @ts-expect-error
          draft.entries.push(User.fromEvent(event))
          break
        }
        case "step.started": {
          if (pendingAssistant) pendingAssistant.time.completed = event.timestamp
          draft.entries.push({
            id: event.id,
            type: "assistant",
            time: {
              created: event.timestamp,
            },
            content: [],
          })
          break
        }
        case "text.started": {
          if (!pendingAssistant) break
          pendingAssistant.content.push({
            type: "text",
            text: "",
          })
          break
        }
        case "text.delta": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "text")
          if (match) match.text += event.delta
          break
        }
        case "text.ended": {
          break
        }
        case "tool.input.started": {
          if (!pendingAssistant) break
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
          break
        }
        case "tool.input.delta": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "tool")
          // oxlint-disable-next-line no-base-to-string -- event.delta is a Schema.String (runtime string)
          if (match) match.state.input += event.delta
          break
        }
        case "tool.input.ended": {
          break
        }
        case "tool.called": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "tool")
          if (match) {
            match.time.ran = event.timestamp
            match.state = {
              status: "running",
              input: event.input,
            }
          }
          break
        }
        case "tool.success": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "tool")
          if (match && match.state.status === "running") {
            match.state = {
              status: "completed",
              input: match.state.input,
              output: event.output ?? "",
              title: event.title,
              metadata: event.metadata ?? {},
              // @ts-expect-error
              attachments: event.attachments ?? [],
            }
          }
          break
        }
        case "tool.error": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "tool")
          if (match && match.state.status === "running") {
            match.state = {
              status: "error",
              error: event.error,
              input: match.state.input,
              metadata: event.metadata ?? {},
            }
          }
          break
        }
        case "reasoning.started": {
          if (!pendingAssistant) break
          pendingAssistant.content.push({
            type: "reasoning",
            text: "",
          })
          break
        }
        case "reasoning.delta": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "reasoning")
          if (match) match.text += event.delta
          break
        }
        case "reasoning.ended": {
          if (!pendingAssistant) break
          const match = pendingAssistant.content.findLast((x) => x.type === "reasoning")
          if (match) match.text = event.text
          break
        }
        case "step.ended": {
          if (!pendingAssistant) break
          pendingAssistant.time.completed = event.timestamp
          pendingAssistant.cost = event.cost
          pendingAssistant.tokens = event.tokens
          break
        }
      }
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
}
