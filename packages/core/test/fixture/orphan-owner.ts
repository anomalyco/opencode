// Spawns orphan.cjs through the spawner and keeps it running, so a test can end this process abruptly.
import path from "node:path"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { LayerNode } from "@opencode/util/effect/layer-node"

Effect.gen(function* () {
  const handle = yield* ChildProcess.make("node", [path.join(import.meta.dir, "orphan.cjs"), process.argv[2], "stay"])
  yield* handle.stdout.pipe(Stream.take(1), Stream.runDrain)
  console.log("ready")
  return yield* Effect.never
}).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromise)
