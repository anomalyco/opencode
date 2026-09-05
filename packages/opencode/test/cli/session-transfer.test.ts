import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer, Schema } from "effect"
import { inArray } from "drizzle-orm"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceRef } from "@/effect/instance-ref"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { collectSessionTree } from "../../src/cli/cmd/export"
import { SessionTransferArchive } from "../../src/cli/cmd/session-transfer"
import { importSessionTransfer } from "../../src/cli/cmd/import"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      Database.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const addMessage = Effect.fn("SessionTransferTest.addMessage")(function* (sessionID: SessionID, text: string) {
  const service = yield* Session.Service
  const message: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model,
  }
  yield* service.updateMessage(message)
  yield* service.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: message.id,
    type: "text",
    text,
  })
})

const targetContext = Effect.fn("SessionTransferTest.targetContext")(function* () {
  const source = yield* InstanceRef
  if (!source) return yield* Effect.die(new Error("missing instance context"))
  const { db } = yield* Database.Service
  const directory = path.join(source.directory, "target")
  const projectID = ProjectV2.ID.make("target-project")
  yield* db
    .insert(ProjectTable)
    .values({
      id: projectID,
      worktree: AbsolutePath.make(directory),
      sandboxes: [],
      time_created: Date.now(),
      time_updated: Date.now(),
    })
    .run()
    .pipe(Effect.orDie)
  return {
    source,
    target: {
      directory,
      worktree: directory,
      project: {
        ...source.project,
        id: projectID,
        worktree: directory,
      },
    },
  }
})

describe("session transfer", () => {
  it.instance("collects and imports nested subagent transcripts", () =>
    Effect.gen(function* () {
      const service = yield* Session.Service
      const root = yield* service.create({ title: "root" })
      const child = yield* service.create({ title: "child", parentID: root.id })
      const grandchild = yield* service.create({ title: "grandchild", parentID: child.id })
      yield* addMessage(root.id, "root message")
      yield* addMessage(child.id, "child message")
      yield* addMessage(grandchild.id, "grandchild message")

      const sessions = yield* collectSessionTree(service, root)
      const second = yield* collectSessionTree(service, root)
      expect(sessions.map((session) => session.info.id)).toEqual([root.id, child.id, grandchild.id])
      expect(second.map((session) => session.info.id)).toEqual(sessions.map((session) => session.info.id))
      expect(sessions.map((session) => session.messages[0]?.parts[0]?.type)).toEqual(["text", "text", "text"])

      const archive: SessionTransferArchive = {
        version: 1,
        rootSessionID: root.id,
        sessions,
      }
      expect(() => Schema.decodeUnknownSync(SessionTransferArchive)(JSON.parse(JSON.stringify(archive)))).not.toThrow()
      const context = yield* targetContext()
      yield* importSessionTransfer(archive, context.target)
      yield* importSessionTransfer(archive, context.target)

      const ids = sessions.map((session) => session.info.id)
      const { db } = yield* Database.Service
      const rows = yield* db.select().from(SessionTable).where(inArray(SessionTable.id, ids)).all().pipe(Effect.orDie)
      expect(rows).toHaveLength(3)
      expect(rows.every((row) => row.project_id === context.target.project.id)).toBe(true)
      expect(rows.every((row) => row.directory === context.target.directory)).toBe(true)
      expect(rows.find((row) => row.id === child.id)?.parent_id).toBe(root.id)
      expect(rows.find((row) => row.id === grandchild.id)?.parent_id).toBe(child.id)

      const messages = yield* db
        .select()
        .from(MessageTable)
        .where(inArray(MessageTable.session_id, ids))
        .all()
        .pipe(Effect.orDie)
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.session_id, ids))
        .all()
        .pipe(Effect.orDie)
      expect(messages).toHaveLength(3)
      expect(parts).toHaveLength(3)
      expect(parts.every((part) => messages.some((message) => message.id === part.message_id))).toBe(true)
    }),
  )

  // * Some legacy tree transfers will fail after this upgrade; confirm the compatibility tradeoff before shipping.
  it.instance("rejects a legacy import that would strand a subagent Session", () =>
    Effect.gen(function* () {
      const service = yield* Session.Service
      const root = yield* service.create({ title: "root" })
      yield* service.create({ title: "child", parentID: root.id })
      yield* addMessage(root.id, "root message")
      const legacy = (yield* collectSessionTree(service, root))[0]
      const context = yield* targetContext()

      const error = yield* importSessionTransfer(legacy, context.target).pipe(Effect.flip)
      expect(error.message).toContain(`Cannot move Session ${root.id} because subagent Session`)

      const { db } = yield* Database.Service
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(inArray(SessionTable.id, [root.id]))
        .get()
        .pipe(Effect.orDie)
      expect(row?.project_id).toBe(context.source.project.id)
      expect(row?.directory).toBe(context.source.directory)
    }),
  )
})
