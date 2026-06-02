import { Effect } from "effect"
import { effectCmd, fail } from "../../effect-cmd"
import { MemoryStore } from "@/self-improvement/memory-store"
import type { AppServices } from "@/effect/app-runtime"
import type { InstanceStore } from "@/project/instance-store"

export const MemoryShowCommand = effectCmd({
  command: "show <id>",
  describe: "show full details of a memory",
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "memory ID",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.MemoryShow")(function* (args) {
    const store = yield* Effect.provide(MemoryStore.Service, MemoryStore.defaultLayer)
    const row = yield* store.get(args.id)

    if (!row) {
      return yield* fail(`Memory not found: ${args.id}`)
    }

    let tags: string[] = []
    try { tags = JSON.parse(row.tags) } catch { /* corrupted data — show empty */ }
    const created = new Date(row.time_created).toISOString()
    const accessed = new Date(row.time_last_accessed).toISOString()
    const evolved = row.time_last_evolved
      ? new Date(row.time_last_evolved).toISOString()
      : "never"
    const heartbeat = row.heartbeat_at
      ? new Date(row.heartbeat_at).toISOString()
      : "never"

    console.log(`ID: ${row.id}`)
    console.log(`Title: ${row.title}`)
    console.log(`Type: ${row.type}`)
    console.log(`Layer: ${row.layer}`)
    console.log(`Importance: ${row.importance.toFixed(2)}`)
    console.log(`Confidence: ${row.confidence.toFixed(2)}`)
    console.log(`Access Count: ${row.access_count}`)
    console.log(`Version: ${row.version}`)
    console.log(`Tags: ${tags.length > 0 ? tags.join(", ") : "(none)"}`)
    console.log(`Created: ${created}`)
    console.log(`Last Accessed: ${accessed}`)
    console.log(`Last Evolved: ${evolved}`)
    console.log(`Heartbeat: ${heartbeat}`)
    console.log(`Session: ${row.session_id}`)
    console.log(`Workspace: ${row.workspace_id ?? "(none)"}`)
    console.log(`\nContent:\n${row.content}`)
  }) as (args: any) => Effect.Effect<any, any, AppServices | InstanceStore.Service>,
})
