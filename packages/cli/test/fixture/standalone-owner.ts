import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect"
import path from "node:path"
import { Standalone } from "../../src/services/standalone"

process.argv[1] = path.join(import.meta.dir, "../../src/index.ts")

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const endpoint = yield* Standalone.start()
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/health", endpoint.url), { headers: Service.headers(endpoint) }),
      )
      console.log(`${endpoint.pid} ${endpoint.url} ${response.status}`)
      return yield* Effect.never
    }),
  ),
)
