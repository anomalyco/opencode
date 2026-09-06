import { Global } from "@opencode-ai/util/global"
import { Effect, Exit, Scope } from "effect"
import { createInterface } from "node:readline"
import { Heap } from "../../src/heap"

const scope = await Effect.runPromise(Scope.make())
try {
  await Effect.runPromise(
    Heap.listen.pipe(
      Effect.provideService(Global.Service, Global.make({ log: process.argv[2] })),
      Effect.provideService(Scope.Scope, scope),
    ),
  )
  console.log("ready")
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === "exit") break
    if (line === "close") {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      console.log(`closed:${process.listenerCount("SIGUSR1")}`)
      continue
    }
    console.log("pong")
  }
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  process.stdin.destroy()
}
