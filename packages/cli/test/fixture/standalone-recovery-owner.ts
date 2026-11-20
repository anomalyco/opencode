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
      const live = yield* instance.reconnect()
      process.kill(previous.pid, "SIGKILL")
      yield* Effect.exit(previous.exited)

      const next = yield* instance.reconnect()
      const reused = yield* instance.reconnect()
      yield* instance.restart()
      const restarted = yield* instance.reconnect()
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/info", restarted.url), { headers: Service.headers(restarted) }),
      )
      console.log(
        `STANDALONE_RECOVERED ${previous.pid} ${live.pid} ${next.pid} ${reused.pid} ${restarted.pid} ${response.status}`,
      )
      return yield* Effect.never
    }),
  ),
)
