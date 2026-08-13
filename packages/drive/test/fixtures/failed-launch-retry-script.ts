import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  launch: "manual",
  run: ({ server, artifacts }) =>
    Effect.gen(function* () {
      const first = yield* server.launch().pipe(Effect.flip)
      const firstPid = yield* servicePid(artifacts)
      yield* waitUntilStopped(firstPid)

      const second = yield* server.launch().pipe(Effect.flip)
      const secondPid = yield* servicePid(artifacts)
      yield* waitUntilStopped(secondPid)

      if (first.operation !== "opencode.connect" || second.operation !== "opencode.connect")
        return yield* Effect.fail(new Error(`unexpected launch failures: ${first.operation}, ${second.operation}`))
      if (firstPid === secondPid)
        return yield* Effect.fail(new Error("failed launch did not start a fresh server process"))

      yield* Effect.tryPromise(() =>
        Bun.write(`${artifacts}/failed-launch-retry.json`, JSON.stringify({ firstPid, secondPid })),
      )
    }),
})

const servicePid = (artifacts: string) =>
  Effect.tryPromise(() => Bun.file(`${artifacts}/service.pid`).text().then(Number))

const waitUntilStopped = (pid: number) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100 && running(pid); attempt++) yield* Effect.sleep(10)
    if (running(pid)) return yield* Effect.fail(new Error(`server process ${pid} is still running`))
  })

function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
