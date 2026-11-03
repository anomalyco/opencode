// Child process for the cross-process snapshot probe: edits its own file and captures repeatedly,
// printing the number of failed captures.
import path from "path"
import { Effect, Logger } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Snapshot } from "../src/snapshot"
import { Global } from "@opencode/util/global"

const [data, directory, id, count] = process.argv.slice(2)
const layer = AppNodeBuilder.build(Snapshot.node, [
  Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory!) }))),
  Global.node.replace(Global.layerWith({ data: data!, config: path.join(data!, "config") })),
])

const failures = await Effect.runPromise(
  Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    let failed = 0
    for (let index = 0; index < Number(count); index++) {
      yield* Effect.promise(() => Bun.write(path.join(directory!, `worker-${id}.txt`), `${index}\n`))
      if ((yield* snapshot.capture()) === undefined) failed++
    }
    return failed
  }).pipe(Effect.provide(layer), Effect.provide(Logger.layer([]))),
)
console.log(failures)
