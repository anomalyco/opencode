import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ToolPayload } from "@opencode-ai/core/session/tool-payload"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

const setup = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
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
        slug: "tool-payload-test",
        directory: "/project",
        title: "Tool payload test",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    return db
  })

describe("ToolPayload", () => {
  it.effect("round-trips a multi-megabyte body while keeping thin event data under budget", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("ses_tool_payload_mega")
      const db = yield* setup(sessionID)
      const mega = "a".repeat(3 * 1024 * 1024)
      const body: ToolPayload.Body = {
        structured: { mime: "image/png", bytes: mega.length },
        content: [{ type: "file", uri: `data:image/png;base64,${mega}`, mime: "image/png", name: "huge.png" }],
      }
      const hash = yield* ToolPayload.insert(db, sessionID, body)
      const loaded = yield* ToolPayload.load(db, sessionID, hash)
      expect(loaded).toEqual(body)

      const thin = {
        sessionID,
        assistantMessageID: "msg_test",
        callID: "call_test",
        ...ToolPayload.preview(body),
        executed: false,
        payloadHash: hash,
      }
      expect(JSON.stringify(thin).includes(mega)).toBe(false)
      expect(Buffer.byteLength(JSON.stringify(thin), "utf-8")).toBeLessThanOrEqual(ToolPayload.MaxEventDataBytes)
      const ok = yield* ToolPayload.assertEventDataBudget(thin).pipe(Effect.exit)
      expect(Exit.isSuccess(ok)).toBe(true)
    }),
  )

  it.effect("fails the event-data budget when the thin payload is still oversized", () =>
    Effect.gen(function* () {
      const oversized = {
        sessionID: SessionSchema.ID.make("ses_tool_payload_budget"),
        callID: "call",
        assistantMessageID: "msg",
        structured: { pad: "x".repeat(ToolPayload.MaxEventDataBytes) },
        content: [],
        executed: false,
        payloadHash: ToolPayload.Hash.make("a".repeat(64)),
      }
      const result = yield* ToolPayload.assertEventDataBudget(oversized).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }),
  )
})
