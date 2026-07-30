import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionRecovery } from "@opencode-ai/core/session/recovery"
import { MessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node])))
const sessionID = SessionV2.ID.make("ses_recovery_test")

describe("SessionRecovery", () => {
  it.effect("recovers interrupted assistant messages without overwriting existing finish reasons", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service

      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test-recovery",
          directory: "/project",
          title: "test-recovery",
          version: "test",
          time_created: 1000,
          time_updated: 1000,
        })
        .run()

      // Message 1: Inflight assistant message with no finish reason and no completed time
      const msgInflight = "msg_inflight"
      yield* db
        .insert(MessageTable)
        .values({
          id: msgInflight as any,
          session_id: sessionID,
          time_created: 1000,
          data: {
            role: "assistant",
            time: { created: 1000 },
          } as any,
        })
        .run()

      // Message 2: Completed step assistant message with finish = 'stop', but time.completed missing
      const msgStopped = "msg_stopped"
      yield* db
        .insert(MessageTable)
        .values({
          id: msgStopped as any,
          session_id: sessionID,
          time_created: 2000,
          data: {
            role: "assistant",
            finish: "stop",
            time: { created: 2000 },
          } as any,
        })
        .run()

      // Run recovery
      yield* SessionRecovery.recover

      const rows = yield* db
        .select()
        .from(MessageTable)
        .where(MessageTable.session_id.eq(sessionID))
        .all()
        .pipe(Effect.orDie)

      const inflight = rows.find((r) => r.id === msgInflight)!
      const stopped = rows.find((r) => r.id === msgStopped)!

      // Verify inflight message was marked as interrupted
      expect(inflight.data.time?.completed).toBeDefined()
      expect(inflight.data.finish).toBe("interrupted")
      expect(inflight.data.error).toMatchObject({
        name: "MessageAbortedError",
        data: { message: "Session was interrupted by a crash or restart" },
      })

      // Verify stopped message got time.completed set, but finish remains 'stop'
      expect(stopped.data.time?.completed).toBeDefined()
      expect(stopped.data.finish).toBe("stop")

      // Verify session updated timestamp changed
      const session = yield* db.select().from(SessionTable).where(SessionTable.id.eq(sessionID)).get().pipe(Effect.orDie)
      expect(session?.time_updated).toBeGreaterThan(1000)
    }),
  )
})
