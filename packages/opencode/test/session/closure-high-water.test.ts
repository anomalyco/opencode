import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Effect, Layer } from "effect"
import { SessionClosureHighWater } from "@/session/closure/high-water"
import { SessionClosureModel as Model } from "@/session/closure/model"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { itBounded as it } from "../lib/effect"

// The direct Message/Part row-column high-water read.
//
// The adapter deliberately does not read `Session.messages()`: V1 User Message data exposes
// `time.created` but no `time.updated`, while both physical tables spread the non-null
// `time_created` / `time_updated` columns from `Timestamps`. This integration fixture makes that
// distinction observable by putting a larger, contradictory time inside the JSON payload.

const session = (value: string) => SessionID.make(value)
const modelSession = (value: string) => Model.id("session", value)

describe("closure.high-water adapter", () => {
  it.live("returns each requested session's row-column maximum and omits sessions with no rows", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const database = Database.layerFromPath(":memory:")

      yield* Effect.gen(function* () {
        const { db } = yield* Database.Service
        const highWater = yield* SessionClosureHighWater.Service
        const project = ProjectV2.ID.make("project_high_water")
        const directoryPath = AbsolutePath.make(directory)
        const first = session("ses_high_water_first")
        const second = session("ses_high_water_second")
        const empty = session("ses_high_water_empty")

        yield* db
          .insert(ProjectTable)
          .values({ id: project, worktree: directoryPath, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values(
            [first, second, empty].map((id) => ({
              id,
              project_id: project,
              slug: String(id),
              directory: directoryPath,
              title: String(id),
              version: "test",
            })),
          )
          .run()
          .pipe(Effect.orDie)

        const firstMessage = MessageID.make("msg_high_water_first")
        const secondMessage = MessageID.make("msg_high_water_second")
        yield* db
          .insert(MessageTable)
          .values([
            {
              id: firstMessage,
              session_id: first,
              time_created: 10,
              time_updated: 20,
              // Deliberately larger than every row column. Reading V1 payload time would return the
              // wrong answer and turn this assertion red.
              data: { role: "user", time: { created: 999_999 } } as never,
            },
            {
              id: secondMessage,
              session_id: second,
              time_created: 100,
              time_updated: 90,
              data: { role: "user", time: { created: 999_999 } } as never,
            },
          ])
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(PartTable)
          .values({
            id: PartID.make("prt_high_water_first"),
            message_id: firstMessage,
            session_id: first,
            time_created: 30,
            // The winning axis is a PART'S update column. The other three row-column axes are all
            // lower, so dropping PartTable or `time_updated` is independently observable.
            time_updated: 40,
            data: { type: "text", text: "row-column evidence" } as never,
          })
          .run()
          .pipe(Effect.orDie)

        const firstTarget = modelSession(first)
        const emptyTarget = modelSession(empty)
        const secondTarget = modelSession(second)
        const rows = yield* highWater.read([firstTarget, emptyTarget, secondTarget])

        // Positive precondition for the omission assertion: the adapter returned real evidence for
        // both sessions that have rows, so an empty result cannot make the negative pass vacuously.
        expect(rows).toHaveLength(2)
        expect(rows.map((row) => row.session)).toEqual([firstTarget, secondTarget])
        expect(rows.map((row) => row.millis)).toEqual([40, 100])
        expect(rows.some((row) => row.session === emptyTarget)).toBe(false)

        // Requested Model.SessionIDs are passed through rather than reconstructed.
        expect(rows[0]?.session).toBe(firstTarget)
        expect(rows[1]?.session).toBe(secondTarget)
      }).pipe(Effect.provide(SessionClosureHighWater.layer.pipe(Layer.provideMerge(database))))
    }).pipe(Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )
})
