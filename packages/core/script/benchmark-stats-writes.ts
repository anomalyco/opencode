import { parseArgs } from "util"
import { DateTime, Effect, Logger, Schema } from "effect"
import { sql } from "drizzle-orm"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "../src/bus"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionProjector } from "../src/session/projector"
import { SessionMessageTable, SessionTable } from "../src/session/sql"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    bytes: { type: "string", default: "65536" },
    updates: { type: "string", default: "100" },
    runs: { type: "string", default: "7" },
    compact: { type: "boolean", default: false },
  },
})
const bytes = Number(args.values.bytes)
const updates = Number(args.values.updates)
const runs = Number(args.values.runs)
if (![bytes, updates, runs].every((value) => Number.isInteger(value) && value > 0)) throw new Error("Invalid arguments")
const layer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node]))
const sessionID = Session.ID.make("ses_stats_write_bench")
const messageID = SessionMessage.ID.make("msg_stats_write_bench")
const text = "x".repeat(bytes)

// Each sample gets a new in-memory database. Exercise the production content
// projector, not a hand-written UPDATE. Event retention is disabled in both
// cases to isolate projection cost rather than grow a second payload archive.
const measure = (indexed: boolean) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    if (!indexed || args.values.compact) yield* database.db.run("DROP INDEX session_message_stats_idx")
    if (indexed && args.values.compact)
      yield* database.db.run(
        "CREATE INDEX session_message_stats_idx ON session_message(time_created, session_id, type, json_extract(data, '$.model', '$.tokens', '$.cost'))",
      )
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/stats-bench"), sandboxes: [] })
      .run()
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "stats",
        directory: "/stats-bench",
        version: "test",
      })
      .run()
    const { id, type, ...data } = Schema.encodeSync(SessionMessage.Info)(
      SessionMessage.Assistant.make({
        id: messageID,
        type: "assistant",
        agent: Agent.ID.make("build"),
        model: { providerID: Provider.ID.make("example"), id: Model.ID.make("model-a") },
        time: { created: DateTime.makeUnsafe(0) },
        content: [{ type: "text", text }],
      }),
    )
    yield* database.db
      .insert(SessionMessageTable)
      .values({ id: SessionMessage.ID.make(id), type, data, session_id: sessionID, seq: 0, time_created: 0 })
      .run()
    const start = performance.now()
    yield* Effect.forEach(
      Array.from({ length: updates }),
      (_, index) =>
        bus.publish(SessionEvent.MessageContentUpdated, {
          sessionID,
          messageID,
          content: [{ type: "text", text: text + index }],
        }),
      { concurrency: 1, discard: true },
    )
    const ms = (performance.now() - start) / updates
    const row = yield* database.db.get<{ text: string }>(
      sql`SELECT json_extract(data, '$.content[0].text') AS text FROM session_message WHERE id = ${messageID}`,
    )
    if (row?.text !== text + (updates - 1)) throw new Error("Content projection did not update the message")
    return { indexed, ms }
  }).pipe(Effect.provide(layer), Effect.provide(Logger.layer([])))

const samples = await Effect.runPromise(
  Effect.forEach(Array.from({ length: runs + 1 }), (_, run) =>
    Effect.forEach(run % 2 === 0 ? [false, true] : [true, false], (indexed) =>
      measure(indexed).pipe(
        Effect.tap((sample) =>
          Effect.sync(() => console.log(JSON.stringify({ run, warmup: run === 0, bytes, ...sample }))),
        ),
      ),
    ),
  ),
)
for (const indexed of [false, true]) {
  const sorted = samples
    .slice(1)
    .flat()
    .filter((sample) => sample.indexed === indexed)
    .map((sample) => sample.ms)
    .toSorted((a, b) => a - b)
  console.log(
    `METRIC stats_write_${indexed ? "indexed" : "baseline"}_median_ms=${sorted[Math.floor(sorted.length / 2)].toFixed(4)}`,
  )
}
