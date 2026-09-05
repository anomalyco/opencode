import { parseArgs } from "util"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Database } from "../src/database/database"
import migration from "../src/database/migration/20260905155702_stats-covering-index"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    database: { type: "string" },
    steps: { type: "string", default: "80000" },
    bytes: { type: "string", default: "65536" },
  },
})
const steps = Number(args.values.steps)
const bytes = Number(args.values.bytes)
if (!args.values.database || ![steps, bytes].every((value) => Number.isInteger(value) && value > 0)) {
  throw new Error("Pass --database <new-file.db>, with positive --steps and --bytes")
}
if (await Bun.file(args.values.database).exists()) throw new Error("Refusing to replace an existing database")

// Synthetic, pre-migration data for matched Drive recordings. The after server
// builds its index at startup; neither recording uses private conversation data.
await Effect.runPromise(
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    yield* db.run("PRAGMA journal_mode = DELETE")
    yield* db.run("DROP INDEX session_message_stats_idx")
    yield* db.run(sql`DELETE FROM migration WHERE id = ${migration.id}`)
    const from = Date.UTC(2026, 0, 1)
    const data = JSON.stringify({
      agent: "build",
      model: { providerID: "example", id: "model-a" },
      time: { created: from, completed: from + 1 },
      content: [{ type: "text", text: "Synthetic history. ".repeat(Math.ceil(bytes / 19)).slice(0, bytes) }],
      tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 800, write: 0 } },
      cost: 0.001,
    })
    yield* db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.run(sql`INSERT INTO project(id, worktree, sandboxes, time_created, time_updated)
        VALUES ('stats-fixture', '/stats-fixture', '[]', ${from}, ${from})`)
        yield* tx.run(sql`
        WITH RECURSIVE numbers(n) AS (VALUES(0) UNION ALL SELECT n + 1 FROM numbers WHERE n < 99)
        INSERT INTO session_v2(id, project_id, slug, directory, title, version, time_created, time_updated)
        SELECT printf('ses_stats_%04d', n), 'stats-fixture', printf('stats-%04d', n),
          '/stats-fixture', printf('Synthetic history %04d', n), 'fixture', ${from}, ${from}
        FROM numbers
      `)
        yield* tx.run(sql`
        WITH RECURSIVE numbers(n) AS (VALUES(0) UNION ALL SELECT n + 1 FROM numbers WHERE n < ${steps - 1})
        INSERT INTO session_message(id, session_id, type, seq, time_created, time_updated, data)
        SELECT printf('msg_stats_%08d', n), printf('ses_stats_%04d', n % 100), 'assistant', n + 1,
          ${from} + CAST(n * ${240 * 86400000} / ${steps} AS INTEGER),
          ${from} + CAST(n * ${240 * 86400000} / ${steps} AS INTEGER),
          json_set(${data},
            '$.time.created', ${from} + CAST(n * ${240 * 86400000} / ${steps} AS INTEGER),
            '$.time.completed', ${from} + CAST(n * ${240 * 86400000} / ${steps} AS INTEGER) + 1)
        FROM numbers
      `)
      }),
    )
    console.log(JSON.stringify({ database: args.values.database, steps, bytes, sessions: 100 }))
  }).pipe(Effect.provide(AppNodeBuilder.build(Database.configured({ path: args.values.database })))),
)
