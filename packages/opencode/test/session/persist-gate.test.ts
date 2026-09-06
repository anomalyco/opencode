import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session as SessionNs } from "@/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { eq } from "drizzle-orm"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
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

const itWithWorkspaces = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      Database.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: true })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

describe("local persist gate (experimentalWorkspaces off)", () => {
  it.instance("projects message/part but writes nothing to the event log", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2Bridge.Service
      const created = yield* session.create({ title: "gate" })
      const received = yield* Deferred.make<string>()
      const unsub = yield* events.listen((event) => {
        if (event.type.includes("message.updated") || event.type.includes("part")) {
          Deferred.doneUnsafe(received, Effect.succeed(event.type))
        }
        return Effect.void
      })
      const info = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: created.id,
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: { created: Date.now() },
        tools: {},
        mode: "",
      } as unknown as SessionV1.Info)
      yield* session.updatePart({
        id: PartID.ascending(),
        sessionID: created.id,
        messageID: info.id,
        type: "text",
        text: "hello world",
      })

      // Projection tables contain the message and part.
      const messages = yield* db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.id, info.id))
        .all()
        .pipe(Effect.orDie)
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(eq(PartTable.message_id, info.id))
        .all()
        .pipe(Effect.orDie)
      expect(messages).toHaveLength(1)
      expect(parts).toHaveLength(1)

      // The durable event log and sequence are untouched for this session.
      const snapshots = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.type, "message.updated.1"))
        .all()
        .pipe(Effect.orDie)
      const seq = yield* db
        .select()
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, created.id))
        .all()
        .pipe(Effect.orDie)
      // session.created persists one sequence row; the gated message update adds none.
      expect(snapshots).toHaveLength(0)
      expect(seq).toHaveLength(1)
      expect(seq[0]?.seq).toBe(0)

      // The event is still delivered to in-process subscribers (SSE/UI path).
      const delivered = yield* Deferred.await(received).pipe(
        Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed("none" as const) }),
      )
      expect(delivered).toContain("message.updated")
      yield* unsub
    }),
  )
})

describe("experimentalWorkspaces ON full event sourcing", () => {
  itWithWorkspaces.instance("persists gated events to the log", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ title: "gate-on" })
      yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID: created.id,
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: { created: Date.now() },
        tools: {},
        mode: "",
      } as unknown as SessionV1.Info)

      const snapshots = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.type, "message.updated.1"))
        .all()
        .pipe(Effect.orDie)
      const seq = yield* db
        .select()
        .from(EventSequenceTable)
        .where(eq(EventSequenceTable.aggregate_id, created.id))
        .all()
        .pipe(Effect.orDie)
      expect(snapshots).toHaveLength(1)
      expect(seq).toHaveLength(1)
      expect(seq[0]?.seq).toBe(1)
    }),
  )
})