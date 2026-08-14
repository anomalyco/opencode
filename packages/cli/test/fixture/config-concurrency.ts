import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem } from "effect"
import { Config } from "../../src/config"

const [mode, directory, started, release, ready] = process.argv.slice(2)
if (!mode || !directory || !started || !release || !ready) throw new Error("missing config concurrency arguments")
if (mode !== "migrate" && mode !== "update") throw new Error(`unknown mode: ${mode}`)

const node = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)))
const state = { writes: 0 }
const writeFileString: FileSystem.FileSystem["writeFileString"] = (target, data, options) => {
  state.writes++
  if (mode !== "migrate" || state.writes !== 1) return node.writeFileString(target, data, options)
  return Effect.gen(function* () {
    yield* Effect.promise(() => Bun.write(started, ""))
    while (!(yield* Effect.promise(() => Bun.file(release).exists()))) yield* Effect.sleep("10 millis")
    yield* node.writeFileString(target, data, options)
  })
}
const fs = new Proxy(node, {
  get(target, property, receiver) {
    if (property === "writeFileString") return writeFileString
    return Reflect.get(target, property, receiver)
  },
})
const service = await Effect.runPromise(
  Config.Service.pipe(
    Effect.provide(Config.layer),
    Effect.provide(Global.layerWith({ config: directory, state: directory })),
    Effect.provideService(FileSystem.FileSystem, fs),
  ),
)

await Bun.write(ready, "")
if (mode === "migrate") await Effect.runPromise(service.get())
if (mode === "update")
  await Effect.runPromise(
    service.update((draft) => {
      draft.mouse = false
    }),
  )
