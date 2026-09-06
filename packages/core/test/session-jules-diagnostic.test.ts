import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { JulesDiagnostic } from "@opencode-ai/core/session/jules-diagnostic"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, JulesDiagnostic.node])))
const sessionID = SessionV2.ID.make("ses_jules_test")
const assistantMessageID = SessionMessage.ID.make("msg_assistant_test")

describe("JulesDiagnostic", () => {
  it.effect("attaches listener to SessionEvent.Step.Failed and processes error events", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service

      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/tmp/test-project"), sandboxes: [] })
        .run()

      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test-slug",
          title: "test-title",
          version: "test-version",
          directory: "/tmp/test-project",
          agent: "build",
          model: { id: "gemini-2.5-pro", providerID: "google" },
          time_created: 0,
          time_updated: 0,
        })
        .run()

      // Publish Step.Failed event
      const now = yield* DateTime.now
      const published = yield* events.publish(SessionEvent.Step.Failed, {
        sessionID,
        timestamp: now,
        assistantMessageID,
        error: { type: "unknown", message: "Provider stream ended prematurely (dropped packets)" },
      })

      expect(published.type).toBe("session.next.step.failed")
      expect(published.data.error.message).toContain("dropped packets")
    }),
  )
})
