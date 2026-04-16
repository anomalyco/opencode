// Primitives.files() streaming conformance.

import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("primitives-files", (register) => {
  register("files() streams paths under a fixture directory", async (ctx) => {
    const dir = path.posix.join(ctx.backend.rootPath, "prim-files-tree")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.mkDir(dir, { recursive: true })
      yield* ctx.ws.writeFile(path.posix.join(dir, "one.txt"), "1")
      yield* ctx.ws.writeFile(path.posix.join(dir, "two.txt"), "2")
      const paths = yield* Stream.runCollect(ctx.ws.files({ cwd: dir }))
      yield* ctx.ws.remove(dir, { recursive: true })
      return [...paths]
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const arr = out as string[]
    const names = arr.map((p) => p.split("/").pop())
    expect(names.sort()).toEqual(["one.txt", "two.txt"])
  })
})
