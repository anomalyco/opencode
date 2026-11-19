import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionMessageTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { TodoTool } from "@opencode/core/tool/plugin/todo"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { Agent } from "@opencode/schema/agent"
import { Document, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { Todo } from "@opencode/schema/todo"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { host } from "./plugin/host"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = { providerID: Provider.ID.make("anthropic"), id: Model.ID.make("claude-sonnet-4-5") }
const first = [{ content: "Write tests", status: "completed" }] as const
const latest = [
  { content: "Write tests", status: "completed" },
  { content: "Ship it", status: "in_progress" },
] as const

describe("TodoTool.ListPlugin", () => {
  it.effect("finds the latest todowrite call far behind the recent messages", () =>
    Effect.gen(function* () {
      const get = yield* serve(true)
      const session = yield* (yield* Session.Service).create({ location })
      yield* insertAssistant(session.id, 1, { todos: first })
      yield* insertAssistant(session.id, 2, { todos: latest })
      yield* insertAssistant(session.id, 3, { todos: [], status: "error" })
      // More than one page of later messages, so the call is outside what a client loads first.
      yield* Effect.forEach(
        Array.from({ length: 120 }, (_, index) => index + 4),
        (seq) => insertAssistant(session.id, seq),
      )

      expect(yield* get(session.id)).toEqual(latest)
    }),
  )

  it.effect("reads the list before the revert boundary", () =>
    Effect.gen(function* () {
      const get = yield* serve(true)
      const session = yield* (yield* Session.Service).create({ location })
      yield* insertAssistant(session.id, 1, { todos: first })
      const reverted = yield* insertAssistant(session.id, 2, { todos: latest })
      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ revert: { messageID: reverted } })
        .where(eq(SessionTable.id, session.id))
        .run()

      expect(yield* get(session.id)).toEqual(first)
    }),
  )

  it.effect("returns no list without the todo flag or for an unknown Session", () =>
    Effect.gen(function* () {
      const session = yield* (yield* Session.Service).create({ location })
      yield* insertAssistant(session.id, 1, { todos: latest })

      expect(yield* (yield* serve(false))(session.id)).toEqual([])
      expect(yield* (yield* serve(true))(Session.ID.make("ses_missing"))).toEqual([])
    }),
  )
})

type Handlers = RpcHandlers<typeof Todo.Definition>

/** Activates the plugin and returns its `get` handler, as the plugin host would call it. */
function serve(enabled: boolean) {
  return Effect.gen(function* () {
    const handlers: { current?: Handlers } = {}
    yield* TodoTool.ListPlugin.effect(
      host({
        rpc: Object.assign(
          () => {
            throw new Error("unused rpc.client")
          },
          {
            register: (_: unknown, registered: Handlers) => {
              handlers.current = registered
              return Effect.succeed({ dispose: Effect.void, events: { emit: () => Effect.void } })
            },
          },
        ) as never,
      }),
    ).pipe(
      Effect.provide(
        Flag.testLayer([
          new Document({
            type: "document",
            info: new Info({ experimental: new ConfigExperimental.Info({ todo: enabled }) }),
          }),
        ]),
      ),
    )
    return (sessionID: Session.ID) => handlers.current!.get({ sessionID }, { error: {} as never })
  })
}

/** Writes an assistant row the way the projector does, with an optional `todowrite` call. */
function insertAssistant(
  sessionID: Session.ID,
  seq: number,
  todo?: { readonly todos: ReadonlyArray<Todo.Info>; readonly status?: "completed" | "error" },
) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const id = SessionMessage.ID.make(`msg_todo_${String(seq).padStart(4, "0")}`)
    yield* db
      .insert(SessionMessageTable)
      .values({
        id,
        session_id: sessionID,
        seq,
        type: "assistant",
        time_created: seq,
        time_updated: seq,
        data: { agent: Agent.ID.make("build"), model, content: [], time: { created: seq, completed: seq + 1 } },
      })
      .run()
    const time = { created: DateTime.makeUnsafe(seq), completed: DateTime.makeUnsafe(seq + 1) }
    const part: SessionMessage.AssistantContent = todo
      ? {
          type: "tool",
          id: `call_${seq}`,
          name: TodoTool.name,
          time,
          state:
            todo.status === "error"
              ? { status: "error", input: { todos: todo.todos }, error: { type: "unknown", message: "boom" } }
              : { status: "completed", input: { todos: todo.todos }, content: [{ type: "text", text: "updated" }] },
        }
      : { type: "text", text: `Reply ${seq}` }
    yield* db
      .insert(SessionPartTable)
      .values({
        message_id: id,
        session_id: sessionID,
        ordinal: 0,
        type: part.type,
        call_id: part.type === "tool" ? part.id : null,
        time_created: seq,
        time_updated: seq,
        data: SessionHistory.encodePart(part),
      })
      .run()
    return id
  })
}
