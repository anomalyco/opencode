import { Database } from "../src/database/database"
import { ProjectTable } from "../src/project/sql"
import { SessionMessageTable, SessionTable } from "../src/session/sql"
import { AbsolutePath } from "../src/schema"
import { SessionStats } from "../src/session/stats"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Money } from "@opencode-ai/schema/money"
import { Project } from "@opencode-ai/schema/project"
import { Provider } from "@opencode-ai/schema/provider"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { Global } from "@opencode-ai/util/global"
import { DateTime, Effect, Layer, Schema } from "effect"
import path from "node:path"

const filename = process.argv[2]
const directory = process.argv[3]
if (!filename || !directory || !path.isAbsolute(filename) || !path.isAbsolute(directory))
  throw new Error("Usage: bun seed-stats.ts /absolute/new.db /absolute/project [--max]")
if (await Bun.file(filename).exists()) throw new Error("Refusing to seed an existing database")

const encode = Schema.encodeSync(SessionMessage.Info)
const now = new Date()
const max = process.argv.includes("--max")
const projectID = Project.ID.make("global")
const models = ["claude-sonnet-4-6", "gpt-5.4", "gemini-3.1-pro"]
const fixtures = Array.from({ length: 731 }, (_, day) => {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 730 + day)
  // Quiet weekends, occasional vacations, a long streak, and increasing usage over two years.
  if (day > 0 && day < 730 && (day < 520 || day >= 565)) {
    if ((date.getDay() === 0 || date.getDay() === 6) && day % 5 !== 0) return []
    if (day % 181 >= 90 && day % 181 < 101) return []
    if (day % 17 === 0) return []
  }
  const scale = !max
    ? 1
    : date.getFullYear() === now.getFullYear()
      ? (3 + ((day * 73 + Math.floor(day / 7) * 19) % 9)) * 0.7187
      : 1 + ((day * 37) % 4)
  return Array.from({ length: 1 + Math.floor(day / 245) + (day % 3) }, (_, index) => {
    const id = Session.ID.make(`ses_stats_demo_${day}_${index}`)
    const created = Math.min(date.getTime() + (9 + index * 2) * 3_600_000, now.getTime() - 1)
    const model = { id: Model.ID.make(models[(day + index) % models.length]), providerID: Provider.ID.make("demo") }
    const messages = Array.from({ length: 12 + ((day * 17 + index * 7) % 52) }, (_, step) => {
      const time = Math.min(created + step * 30_000, now.getTime() - 1)
      if (step % 8 === 0)
        return SessionMessage.User.make({
          id: SessionMessage.ID.make(`msg_demo_${day}_${index}_${step}`),
          type: "user",
          text: "Synthetic stats demo: improve the project and verify the changes.",
          time: { created: DateTime.makeUnsafe(time) },
        })
      return SessionMessage.Assistant.make({
        id: SessionMessage.ID.make(`msg_demo_${day}_${index}_${step}`),
        type: "assistant",
        agent: Agent.ID.make("build"),
        model,
        content: [{ type: "text", text: "Synthetic demo result. No model was called." }],
        cost: Money.USD.make((0.04 + step * 0.001) * scale),
        tokens: {
          input: Math.round((1800 + step * 120) * scale),
          output: Math.round((600 + step * 80) * scale),
          reasoning: Math.round((200 + step * 10) * scale),
          cache: { read: Math.round((210_000 + day * 500 + step * 2000) * scale), write: Math.round(4000 * scale) },
        },
        time: {
          created: DateTime.makeUnsafe(time),
          completed: DateTime.makeUnsafe(Math.min(time + 15_000, now.getTime())),
        },
      })
    })
    const assistants = messages.filter((message) => message.type === "assistant")
    return {
      session: {
        id,
        project_id: projectID,
        directory,
        slug: `stats-demo-${day}-${index}`,
        title: ["Refine the command palette", "Build the project dashboard", "Improve streaming performance"][
          index % 3
        ],
        version: "stats-demo",
        agent: "build",
        model,
        time_created: created,
        time_updated: Math.min(created + messages.length * 30_000, now.getTime()),
        time_idle: Math.min(created + messages.length * 30_000, now.getTime()),
        cost: assistants.reduce((sum, message) => sum + (message.cost ?? 0), 0),
        tokens_input: assistants.reduce((sum, message) => sum + (message.tokens?.input ?? 0), 0),
        tokens_output: assistants.reduce((sum, message) => sum + (message.tokens?.output ?? 0), 0),
        tokens_reasoning: assistants.reduce((sum, message) => sum + (message.tokens?.reasoning ?? 0), 0),
        tokens_cache_read: assistants.reduce((sum, message) => sum + (message.tokens?.cache.read ?? 0), 0),
        tokens_cache_write: assistants.reduce((sum, message) => sum + (message.tokens?.cache.write ?? 0), 0),
      },
      messages: messages.map((message, index): typeof SessionMessageTable.$inferInsert => {
        const encoded = encode(message)
        const { id: messageID, type, ...data } = encoded
        return {
          id: SessionMessage.ID.make(messageID),
          session_id: id,
          type,
          seq: index + 1,
          time_created: encoded.time.created,
          data,
        }
      }),
    }
  })
}).flat()

await Effect.runPromise(
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .insert(ProjectTable)
          .values({ id: projectID, worktree: AbsolutePath.make(directory), name: "Stats demo", sandboxes: [] })
          .run()
        yield* Effect.forEach(
          fixtures,
          (fixture) =>
            Effect.gen(function* () {
              yield* tx.insert(SessionTable).values(fixture.session).run()
              yield* tx.insert(SessionMessageTable).values(fixture.messages).run()
            }),
          { discard: true },
        )
      }),
    )
    const stats = yield* SessionStats.get({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tools: "none" })
    console.log(`Seeded ${stats.sessions} sessions, ${stats.steps} steps, ${stats.activeDays} active days.`)
  }).pipe(Effect.provide(Database.layer({ path: filename }).pipe(Layer.provide(Global.layerWith({}))))),
)
