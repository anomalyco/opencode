import { describe, expect, test } from "bun:test"
import { LLMError, TransportReason } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { claimSessionsInterruptedByShutdown, terminal } from "@opencode-ai/core/session/execution/local"
import { SessionV2 } from "@opencode-ai/core/session"
import { UserInterruptedError } from "@opencode-ai/core/session/error"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { sql } from "drizzle-orm"
import { Context, Effect, Exit, Layer } from "effect"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))

describe("SessionExecutionLocal lifecycle", () => {
  test("classifies success and typed failure terminals", () => {
    expect(terminal(Exit.succeed(undefined))).toEqual({ type: "succeeded" })
    expect(
      terminal(
        Exit.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new TransportReason({ message: "Disconnected" }),
          }),
        ),
      ),
    ).toEqual({ type: "failed", error: { type: "provider.transport", message: "Disconnected" } })
    const storage = new ToolOutputStore.StorageError({ operation: "encode", cause: new Error("invalid output") })
    expect(terminal(Exit.fail(storage))).toEqual({
      type: "failed",
      error: { type: "unknown", message: storage.message },
    })
  })

  test("defaults owner-scope interruption to shutdown and preserves explicit reasons", () => {
    const interrupted = Effect.runSyncExit(Effect.interrupt)
    expect(terminal(interrupted)).toEqual({ type: "interrupted", reason: "shutdown" })
    expect(terminal(interrupted, "user")).toEqual({ type: "interrupted", reason: "user" })
    expect(terminal(interrupted, "superseded")).toEqual({ type: "interrupted", reason: "superseded" })
    expect(terminal(Exit.fail(new UserInterruptedError()))).toEqual({ type: "interrupted", reason: "user" })
  })

  test("claims shutdown recovery once across database connections", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "recovery.sqlite")
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const first = Context.get(yield* Layer.build(Database.layerFromPath(filename)), Database.Service).db
          const second = Context.get(yield* Layer.build(Database.layerFromPath(filename)), Database.Service).db
          const sessionID = SessionV2.ID.make("ses_recover_concurrent")
          yield* first.run(sql`
            INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
            VALUES ('prj_recovery_concurrent', '/tmp/recovery', '[]', 0, 0)
          `)
          yield* first.run(sql`
            INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${sessionID}, 'prj_recovery_concurrent', ${sessionID}, '/tmp/recovery', ${sessionID}, 'test', 0, 0)
          `)
          yield* first.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES (${sessionID}, 1)`)
          yield* first.run(sql`
            INSERT INTO event (id, aggregate_id, seq, created, type, data)
            VALUES ('evt_recovery_concurrent', ${sessionID}, 1, 0, 'session.execution.interrupted.1', '{"sessionID":"ses_recover_concurrent","reason":"shutdown"}')
          `)

          const claims = yield* Effect.all(
            [claimSessionsInterruptedByShutdown(first), claimSessionsInterruptedByShutdown(second)],
            { concurrency: "unbounded" },
          )
          expect(claims.flat()).toEqual([sessionID])
        }),
      ),
    )
  })

  it.effect("claims each latest shutdown interruption once", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const recover = SessionV2.ID.make("ses_recover")
      const completed = SessionV2.ID.make("ses_completed")
      const user = SessionV2.ID.make("ses_user")
      const crashed = SessionV2.ID.make("ses_crashed")

      yield* db.run(sql`
        INSERT INTO project (id, worktree, sandboxes, time_created, time_updated)
        VALUES ('prj_recovery', '/tmp/recovery', '[]', 0, 0)
      `)
      yield* Effect.forEach([recover, completed, user, crashed], (sessionID) =>
        db.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES (${sessionID}, 'prj_recovery', ${sessionID}, '/tmp/recovery', ${sessionID}, 'test', 0, 0)
        `),
      )

      yield* events.publish(SessionEvent.Execution.Started, { sessionID: recover })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: recover, reason: "shutdown" })
      yield* events.publish(SessionEvent.InstructionsUpdated, { sessionID: recover, text: "later non-lifecycle event" })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: completed, reason: "shutdown" })
      yield* events.publish(SessionEvent.Execution.Started, { sessionID: completed })
      yield* events.publish(SessionEvent.Execution.Succeeded, { sessionID: completed })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: user, reason: "user" })
      yield* events.publish(SessionEvent.Execution.Started, { sessionID: crashed })

      const claims = yield* Effect.all(
        [claimSessionsInterruptedByShutdown(db), claimSessionsInterruptedByShutdown(db)],
        { concurrency: "unbounded" },
      )
      expect(claims.flat()).toEqual([recover])

      yield* events.publish(SessionEvent.Execution.Started, { sessionID: recover })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: recover, reason: "shutdown" })
      expect(yield* claimSessionsInterruptedByShutdown(db)).toEqual([recover])
      expect(yield* claimSessionsInterruptedByShutdown(db)).toEqual([])
    }),
  )
})
