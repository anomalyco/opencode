import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  launch: "manual",
  run: ({ server, tools, tuis, artifacts }) =>
    Effect.gen(function* () {
      yield* server.launch()
      const firstServer = Number(yield* Effect.tryPromise(() => Bun.file(`${artifacts}/service.pid`).text()))
      const [alice] = yield* Effect.all(
        [tuis.launch("alice", { recording: true }), tuis.launch("bob", { recording: true })],
        { concurrency: "unbounded" },
      )

      yield* server.kill()
      for (let attempt = 0; attempt < 100 && running(firstServer); attempt++) yield* Effect.sleep(10)
      if (running(firstServer)) return yield* Effect.fail(new Error("the first server is still running"))

      yield* server.launch()
      const secondServer = Number(yield* Effect.tryPromise(() => Bun.file(`${artifacts}/service.pid`).text()))
      if (secondServer === firstServer) return yield* Effect.fail(new Error("the server was not relaunched"))

      const recording = alice.recording
      if (recording === undefined) return yield* Effect.fail(new Error("alice recording was not configured"))
      const aliceRecording = yield* recording.finish()
      yield* alice.close()
      const relaunchedAlice = yield* tuis.launch("alice")
      yield* relaunchedAlice.close()
      yield* tools.attach({
        tools: [
          {
            name: "lookup",
            description: "Look up a value",
            inputSchema: { type: "object" },
            options: { codemode: false },
          },
        ],
      })
      yield* server.kill()

      yield* Effect.tryPromise(() =>
        Bun.write(
          `${artifacts}/kill-server-result.json`,
          JSON.stringify({ firstServer, secondServer, aliceRecording }),
        ),
      )
    }),
})

function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
