import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SubagentCompletion } from "@opencode/core/session/subagent-completion"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionMessage } from "@opencode/schema/session-message"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const awaited: Session.ID[] = []
let duringIdle: Effect.Effect<void> = Effect.void
const execution = Layer.mock(SessionExecution.Service, {
  awaitIdle: (sessionID) =>
    Effect.sync(() => awaited.push(sessionID)).pipe(Effect.andThen(Effect.suspend(() => duringIdle))),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(execution)],
  ),
)

const agent = Agent.ID.make("build")
const model = { providerID: Provider.ID.make("anthropic"), id: Model.ID.make("claude-sonnet-4-5") }

const seedAssistant = (
  sessionID: Session.ID,
  input: {
    id: string
    seq: number
    text?: string
    completed?: boolean
    failed?: boolean
  },
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.make(input.id),
        session_id: sessionID,
        seq: input.seq,
        type: "assistant",
        time_created: input.seq,
        time_updated: input.seq,
        data: {
          agent,
          model,
          content: input.text === undefined ? [] : [{ type: "text", text: input.text }],
          ...(input.failed ? { error: { type: "unknown", message: "boom" } } : {}),
          time: { created: input.seq, ...(input.completed === false ? {} : { completed: input.seq + 1 }) },
        },
      })
      .run()
  })

describe("Session.wait", () => {
  it.effect("delegates to SessionExecution.awaitIdle and returns an empty result for a fresh session", () =>
    Effect.gen(function* () {
      awaited.length = 0
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })

      const result = yield* sessions.wait(session.id)

      expect(awaited).toEqual([session.id])
      expect(result).toEqual({ outcome: undefined, text: SubagentCompletion.NO_TEXT })
    }),
  )

  it.effect("returns the newest completed answer", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_old", seq: 1, text: "older answer" })
      yield* seedAssistant(session.id, { id: "msg_wait_new", seq: 2, text: "newer answer" })

      expect((yield* sessions.wait(session.id)).text).toBe("newer answer")
    }),
  )

  it.effect("skips an incomplete newest answer", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_done", seq: 1, text: "done answer" })
      yield* seedAssistant(session.id, { id: "msg_wait_partial", seq: 2, text: "still streaming", completed: false })

      expect((yield* sessions.wait(session.id)).text).toBe("done answer")
    }),
  )

  it.effect("skips a failed newest answer", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_good", seq: 1, text: "good answer" })
      yield* seedAssistant(session.id, { id: "msg_wait_failed", seq: 2, text: "failed answer", failed: true })

      expect((yield* sessions.wait(session.id)).text).toBe("good answer")
    }),
  )

  it.effect("returns NO_TEXT when the newest assistant has no text parts", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_empty", seq: 1 })

      expect((yield* sessions.wait(session.id)).text).toBe(SubagentCompletion.NO_TEXT)
    }),
  )

  it.effect("reads the outcome after awaitIdle settles", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const database = yield* Database.Service
      const session = yield* sessions.create({ location })
      expect((yield* sessions.get(session.id)).outcome).toBeUndefined()

      duringIdle = Effect.suspend(() =>
        database.db
          .update(SessionTable)
          .set({ idle_outcome: "failed" })
          .where(eq(SessionTable.id, session.id))
          .run()
          .pipe(Effect.orDie, Effect.asVoid),
      )

      expect((yield* sessions.wait(session.id)).outcome).toBe("failed")
      duringIdle = Effect.void
    }),
  )

  it.effect("finds a good answer behind more than a page of failed attempts", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_deep_good", seq: 1, text: "good answer" })
      yield* Effect.forEach(
        Array.from({ length: 45 }, (_, i) => i),
        (i) =>
          i % 2 === 0
            ? seedAssistant(session.id, { id: `msg_wait_deep_failed_${i}`, seq: i + 2, text: "failed", failed: true })
            : seedAssistant(session.id, {
                id: `msg_wait_deep_partial_${i}`,
                seq: i + 2,
                text: "partial",
                completed: false,
              }),
        { discard: true },
      )

      expect((yield* sessions.wait(session.id)).text).toBe("good answer")
    }),
  )

  it.effect("finds a good answer exactly one full page back", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* seedAssistant(session.id, { id: "msg_wait_page_good", seq: 1, text: "good answer" })
      yield* Effect.forEach(
        Array.from({ length: 20 }, (_, i) => i),
        (i) => seedAssistant(session.id, { id: `msg_wait_page_failed_${i}`, seq: i + 2, text: "failed", failed: true }),
        { discard: true },
      )

      expect((yield* sessions.wait(session.id)).text).toBe("good answer")
    }),
  )

  it.effect("returns NO_TEXT when no answer exists across several pages", () =>
    Effect.gen(function* () {
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const session = yield* sessions.create({ location })
      yield* Effect.forEach(
        Array.from({ length: 41 }, (_, i) => i),
        (i) =>
          i % 2 === 0
            ? seedAssistant(session.id, { id: `msg_wait_none_failed_${i}`, seq: i + 1, text: "failed", failed: true })
            : seedAssistant(session.id, {
                id: `msg_wait_none_partial_${i}`,
                seq: i + 1,
                text: "partial",
                completed: false,
              }),
        { discard: true },
      )

      expect((yield* sessions.wait(session.id)).text).toBe(SubagentCompletion.NO_TEXT)
    }),
  )

  it.effect("fails fast for an unknown session without waiting", () =>
    Effect.gen(function* () {
      awaited.length = 0
      duringIdle = Effect.void
      const sessions = yield* Session.Service
      const sessionID = Session.ID.make("ses_wait_missing")

      expect(yield* Effect.flip(sessions.wait(sessionID))).toEqual(new Session.NotFoundError({ sessionID }))
      expect(awaited).toEqual([])
    }),
  )
})
