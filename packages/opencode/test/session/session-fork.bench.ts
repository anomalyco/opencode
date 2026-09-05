import { afterAll, expect } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { count, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import path from "path"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const messageCount = 986
const partCount = 5_657
const stepFinishCount = messageCount / 2
const largeSummaryMessage = 84
const compactionMessage = 100
const compactionTail = 10

const databaseDirectory = await tmpdir()
afterAll(() => databaseDirectory[Symbol.asyncDispose]())

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [Database.node, Database.layerFromPath(path.join(databaseDirectory.path, "session-fork.sqlite"))],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

it.instance(
  "forks a production-sized session",
  () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const source = yield* session.create({ title: "fork benchmark" })
      const messageIDs = Array.from({ length: messageCount }, () => MessageID.ascending())
      const messages = new Array<typeof MessageTable.$inferInsert>()
      const parts = new Array<typeof PartTable.$inferInsert>()
      const largePatch = "x".repeat(25 * 1024 * 1024)

      for (const [index, id] of messageIDs.entries()) {
        const user = index % 2 === 0
        const data = user
          ? {
              role: "user" as const,
              time: { created: index },
              agent: "benchmark",
              model: { providerID: "benchmark", modelID: "benchmark" },
              ...(index === largeSummaryMessage
                ? {
                    summary: {
                      diffs: [
                        {
                          file: "large.txt",
                          patch: largePatch,
                          additions: 1,
                          deletions: 0,
                          status: "modified" as const,
                        },
                      ],
                    },
                  }
                : {}),
            }
          : {
              role: "assistant" as const,
              time: { created: index, completed: index },
              parentID: messageIDs[index - 1],
              modelID: "benchmark",
              providerID: "benchmark",
              mode: "build",
              agent: "benchmark",
              path: { cwd: source.directory, root: source.directory },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            }
        messages.push({
          id,
          session_id: source.id,
          time_created: index,
          time_updated: index,
          data: data as typeof MessageTable.$inferInsert.data,
        })

        const partsForMessage = index < partCount - messageCount * 5 ? 6 : 5
        for (const partIndex of Array.from({ length: partsForMessage }, (_, partIndex) => partIndex)) {
          const data =
            index === compactionMessage && partIndex === 0
              ? { type: "compaction" as const, auto: true, tail_start_id: messageIDs[compactionTail] }
              : !user && partIndex === partsForMessage - 1
                ? {
                    type: "step-finish" as const,
                    reason: "stop",
                    cost: 0.005,
                    tokens: {
                      total: 1_500,
                      input: 500,
                      output: 800,
                      reasoning: 200,
                      cache: { read: 100, write: 50 },
                    },
                  }
                : { type: "text" as const, text: `message ${index} part ${partIndex}` }
          parts.push({
            id: PartID.ascending(),
            message_id: id,
            session_id: source.id,
            time_created: index * 10 + partIndex,
            time_updated: index * 10 + partIndex,
            data: data as typeof PartTable.$inferInsert.data,
          })
        }
      }

      yield* db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db.insert(MessageTable).values(messages).run()
            yield* db.insert(PartTable).values(parts).run()
          }),
        )
        .pipe(Effect.orDie)

      const started = performance.now()
      const fork = yield* session.fork({ sessionID: source.id })
      const duration = performance.now() - started
      const forked = yield* session.messages({ sessionID: fork.id })
      const compaction = forked[compactionMessage]?.parts.find((part) => part.type === "compaction")
      const events = yield* db
        .select({ value: count() })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, fork.id))
        .get()
        .pipe(Effect.orDie)
      const forkInfo = yield* session.get(fork.id)

      expect(forked).toHaveLength(messageCount)
      expect(forked.reduce((total, message) => total + message.parts.length, 0)).toBe(partCount)
      expect(forked[1]?.info.role === "assistant" && forked[1].info.parentID).toBe(forked[0]?.info.id)
      expect(compaction?.type === "compaction" && compaction.tail_start_id).toBe(forked[compactionTail]?.info.id)
      expect(events?.value).toBe(1 + messageCount + partCount)
      expect(forkInfo.cost).toBeCloseTo(stepFinishCount * 0.005)
      expect(forkInfo.tokens).toEqual({
        input: stepFinishCount * 500,
        output: stepFinishCount * 800,
        reasoning: stepFinishCount * 200,
        cache: { read: stepFinishCount * 100, write: stepFinishCount * 50 },
      })

      console.log(
        `session fork: ${duration.toFixed(1)}ms (${messageCount} messages, ${partCount} parts, ${(largePatch.length / 1024 / 1024).toFixed(0)} MiB summary)`,
      )
      console.log(`METRIC session_fork_ms=${duration.toFixed(1)}`)
    }),
  { timeout: 10 * 60 * 1_000 },
)
