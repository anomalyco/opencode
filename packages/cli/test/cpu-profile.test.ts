import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { CpuProfile } from "../src/cpu-profile"

test("subscribes and unsubscribes SIGPROF with the CLI scope", async () => {
  const listeners = process.listenerCount("SIGPROF")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* CpuProfile.listen
        expect(process.listenerCount("SIGPROF")).toBe(listeners + (process.platform === "win32" ? 0 : 1))
      }),
    ).pipe(Effect.provideService(Global.Service, Global.make()), Effect.provide(NodeFileSystem.layer)),
  )
  expect(process.listenerCount("SIGPROF")).toBe(listeners)
})
