import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import path from "node:path"
import { Standalone } from "../../src/services/standalone"

process.chdir(path.join(import.meta.dir, "../../../.."))

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const instance = yield* Standalone.recoverable({
        command: [process.execPath, path.join(import.meta.dir, "../../src/index.ts"), "serve"],
      })
      const previous = instance.endpoint
      process.kill(previous.pid, "SIGKILL")
      yield* Effect.exit(previous.exited)

      const next = yield* instance.reconnect()
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/info", next.url), { headers: Service.headers(next) }),
      )
      console.log(`STANDALONE_RECOVERED ${previous.pid} ${next.pid} ${response.status}`)
      return yield* Effect.never
    }),
  ),
)
