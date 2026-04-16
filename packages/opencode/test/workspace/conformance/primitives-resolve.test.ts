// Primitives.resolve() / containsPath() conformance.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("primitives-resolve", (register) => {
  // resolve / containsPath are pure string ops over `rootPath`: they
  // do not touch the substrate, so they succeed on every backend —
  // including throwing. The conformance assertions are identical
  // across kinds.
  register("resolve leaves absolute paths unchanged", async (ctx) => {
    const abs = path.posix.join(ctx.backend.rootPath, "sub/file.txt")
    const out = await Effect.runPromise(ctx.ws.resolve(abs))
    expect(out).toBe(abs)
  })

  register("resolve joins relative to rootPath", async (ctx) => {
    const out = await Effect.runPromise(ctx.ws.resolve("inner/file.txt"))
    expect(out).toBe(path.posix.join(ctx.backend.rootPath, "inner/file.txt"))
  })

  register("containsPath true for path inside root, false for outside", async (ctx) => {
    const inside = path.posix.join(ctx.backend.rootPath, "a/b/c")
    const outside = "/absolutely/elsewhere-not-in-root"
    const [a, b] = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* ctx.ws.containsPath(inside)
        const b = yield* ctx.ws.containsPath(outside)
        return [a, b] as const
      }),
    )
    expect(a).toBe(true)
    expect(b).toBe(false)
  })
})
