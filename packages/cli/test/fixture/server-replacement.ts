import { Updater } from "../../src/services/updater"
import { ServerProcess } from "../../src/server-process"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import path from "node:path"

let url = ""
let replacementPID = 0

const updater = Updater.Service.of({
  check: () => Effect.die("Unexpected update check"),
  monitor: (input) =>
    Effect.gen(function* () {
      url = input.url
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/health", input.url), {
          headers: { authorization: `Basic ${btoa(`opencode:${input.password}`)}` },
        }),
      )
      if (!response.ok) return yield* Effect.die(new Error("Original server did not become ready"))
      yield* input.restart(null)
      return yield* Effect.never
    }),
  apply: () => Effect.die("Unexpected update application"),
  method: () => Effect.die("Unexpected installation method detection"),
  latest: () => Effect.die("Unexpected latest version lookup"),
  upgrade: () => Effect.die("Unexpected upgrade"),
})

await Effect.runPromise(
  ServerProcess.runWith(
    { mode: "service", hostname: "127.0.0.1", port: 0 },
    {
      updater,
      spawnReplacement: () =>
        Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              const child = spawn(process.execPath, [path.join(import.meta.dir, "replacement-server.ts"), url], {
                detached: true,
                stdio: "ignore",
              })
              child.once("spawn", () => {
                replacementPID = child.pid ?? 0
                child.unref()
                resolve()
              })
              child.once("error", reject)
            }),
          catch: (cause) => new Error("Failed to spawn replacement fixture", { cause }),
        }),
    },
  ),
)

console.log(`RESULT ${JSON.stringify({ url, oldPID: process.pid, replacementPID })}`)
