import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { execDefaults, Failed, makeFiles, makeMemoryDriver } from "../src/environment/index"
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-environment-"))
    const spawner = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ChildProcessSpawner.ChildProcessSpawner
      }).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node))),
    )
    return {
      files: execDefaults(spawner),
      root,
      symlink: (target: string, link: string) =>
        Effect.tryPromise({
          try: () => fs.symlink(target, link),
          catch: (cause) => new Failed({ path: link, cause }),
        }),
    }
  },
  process.platform !== "linux",
)
