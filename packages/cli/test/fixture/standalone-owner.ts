import { Effect } from "effect"
import path from "node:path"
import { Standalone } from "../../src/services/standalone"

process.argv[1] = path.join(import.meta.dir, "../../src/index.ts")

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* Standalone.transport()
      const response = yield* Effect.promise(() => fetch(new URL("/api/health", transport.url), { headers: transport.headers }))
      console.log(`${transport.pid} ${transport.url} ${response.status}`)
      return yield* Effect.never
    }),
  ),
)
