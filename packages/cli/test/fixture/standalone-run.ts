import { Effect, Exit, Scope } from "effect"
import path from "node:path"
import { runNonInteractive } from "../../src/run/run"
import { Standalone } from "../../src/services/standalone"

const [url, log, release] = process.argv.slice(2)
if (!url || !log || !release) throw new Error("Expected URL, spawn log, and release path")

const scope = Scope.makeUnsafe()
const controller = new AbortController()
try {
  const connection = await Effect.runPromise(
    Standalone.connect({
      command: [process.execPath, path.join(import.meta.dir, "standalone-fake.ts"), log, "server-url", url],
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const watch = async () => {
    while (!controller.signal.aborted && !(await Bun.file(release).exists())) await Bun.sleep(25)
    if (!controller.signal.aborted) controller.abort()
  }
  const waiting = watch()
  try {
    await runNonInteractive(
      {
        server: { endpoint: connection.endpoint, service: connection, standalone: true },
        message: ["hello"],
        format: "json",
        file: [],
      },
      controller.signal,
    )
  } finally {
    controller.abort()
    await waiting
  }
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void))
}
