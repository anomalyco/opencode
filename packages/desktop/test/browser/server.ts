import path from "node:path"
import { Effect } from "effect"
import { HttpServer } from "effect/unstable/http"
import { ServerProcess } from "../../../server/src/process"

const stopped = Promise.withResolvers<void>()
process.on("message", (message) => {
  if (message === "stop") stopped.resolve()
})
await Effect.gen(function* () {
  const server = yield* ServerProcess.start({
    hostname: "127.0.0.1",
    port: 0,
    password: process.env.SMOKE_PASSWORD,
    app: { name: "browser-suite-test", version: process.env.SMOKE_VERSION ?? "test", channel: "test" },
    database: { path: ":memory:" },
    models: { fetch: false },
    fs: { filewatcher: false, fff: false },
    config: {
      directory: process.env.OPENCODE_CONFIG_DIR!,
      project: false,
      content: JSON.stringify({
        plugins: ["-opencode.provider.*", path.join(import.meta.dir, "plugin")],
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
      }),
    },
  })
  process.send?.(HttpServer.formatAddress(server.address))
  yield* Effect.promise(() => stopped.promise)
}).pipe(Effect.scoped, Effect.runPromise)
process.disconnect?.()
