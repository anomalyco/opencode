import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Shell } from "@opencode-ai/core/shell"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const withStore = <A, E, R>(body: (fs: FSUtil.Interface, root: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const layer = AppNodeBuilder.build(LayerNode.group([FSUtil.node, Global.node]), [
        Global.node.replace(Global.layerWith({ data: tmp.path })),
      ])
      return Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        return yield* body(fs, tmp.path)
      }).pipe(Effect.provide(layer))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("Shell cleanup", () => {
  it.live("removes expired output files across projects", () =>
    withStore((fs, root) =>
      Effect.gen(function* () {
        const first = path.join(root, Shell.DIRECTORY, "first")
        const second = path.join(root, Shell.DIRECTORY, "second")
        const old = path.join(first, "sh_0123456789abABCDEFGHIJKLMN.out")
        const recent = path.join(second, "sh_0123456789abNOPQRSTUVWXYZ0.out")
        const unrelated = path.join(first, "notes.out")
        yield* fs.ensureDir(first)
        yield* fs.ensureDir(second)
        yield* fs.writeFileString(old, "old")
        yield* fs.writeFileString(recent, "recent")
        yield* fs.writeFileString(unrelated, "unrelated")
        const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
        yield* fs.utimes(old, new Date(), expired)
        yield* fs.utimes(unrelated, new Date(), expired)

        yield* Shell.cleanup()

        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
        expect(yield* fs.exists(unrelated)).toBe(true)
      }),
    ),
  )
})
