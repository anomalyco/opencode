import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionRevert } from "@opencode-ai/core/session/revert"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { testEffect } from "./lib/effect"

const interruptCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set<SessionV2.ID>()),
    resume: () => Effect.void,
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
      }),
    wake: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [[SessionExecution.node, execution]],
  ),
)
const sessionID = SessionV2.ID.make("ses_revert_test")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInput.find(db, id))

describe("SessionRevert", () => {
  it.effect("stages undo for an admitted input after interrupt without requiring promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const database = yield* Database.Service
      const first = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Start working" }),
        resume: false,
      })
      yield* SessionInput.promoteSteers(database.db, events, sessionID, Number.MAX_SAFE_INTEGER)
      yield* events.publish(SessionEvent.Step.Started, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_assistant_active"),
        timestamp: yield* DateTime.now,
        agent: "build",
        model: { id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") },
      })

      const pending = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Steer after interrupt" }),
        resume: false,
      })
      interruptCalls.length = 0
      yield* session.interrupt(sessionID)

      expect(interruptCalls).toEqual([sessionID])
      expect(yield* admitted(pending.id)).not.toHaveProperty("promotedSeq")
      expect(yield* session.messages({ sessionID, order: "asc" })).toMatchObject([
        { type: "user", text: "Start working" },
        { type: "assistant", id: "msg_assistant_active" },
      ])

      const revert = yield* SessionRevert.stage({
        session: yield* session.get(sessionID),
        messageID: pending.id,
      }).pipe(Effect.provide(Snapshot.noopLayer))

      expect(revert.messageID).toBe(pending.id)
      expect((yield* session.get(sessionID)).revert?.messageID).toBe(pending.id)
      expect(yield* admitted(pending.id)).toMatchObject({ id: pending.id })

      yield* session.revert.commit(sessionID)

      expect(yield* admitted(pending.id)).toBeUndefined()
      expect((yield* session.get(sessionID)).revert).toBeUndefined()
      expect(yield* session.messages({ sessionID, order: "asc" })).toMatchObject([
        { type: "user", text: "Start working" },
        { type: "assistant", id: "msg_assistant_active" },
      ])
      expect(yield* admitted(first.id)).toMatchObject({ id: first.id, promotedSeq: 1 })
    }),
  )

  it.effect("still rejects a revert boundary that is neither a message nor an admitted input", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const failure = yield* SessionRevert.stage({
        session: yield* session.get(sessionID),
        messageID: SessionMessage.ID.make("msg_missing"),
      }).pipe(Effect.provide(Snapshot.noopLayer), Effect.flip)

      expect(failure._tag).toBe("Session.MessageNotFoundError")
      expect(failure).toMatchObject({ sessionID, messageID: "msg_missing" })
    }),
  )
})
