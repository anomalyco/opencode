import fs from "node:fs/promises"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { execDefaults, Failed, makeFiles, makeMemoryDriver } from "../src/environment/index"
import { tmpdir } from "./fixture/tmpdir"
import { environmentConformance } from "./lib/environment-conformance"

environmentConformance("memory environment", () => {
  const driver = makeMemoryDriver()
  return {
    files: makeFiles(driver),
    root: `/workspace-${crypto.randomUUID()}`,
    symlink: driver.symlink,
  }
})

environmentConformance(
  "GNU exec environment",
  async () => {
    const spawner = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ChildProcessSpawner.ChildProcessSpawner
      }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
    )
    const tmp = await tmpdir("opencode-environment-")
    return {
      files: execDefaults(spawner),
      root: tmp.path,
      symlink: (target: string, link: string) =>
        Effect.tryPromise({
          try: () => fs.symlink(target, link),
          catch: (cause) => new Failed({ path: link, cause }),
        }),
      dispose: () => tmp[Symbol.asyncDispose](),
    }
  },
  process.platform !== "linux",
)
