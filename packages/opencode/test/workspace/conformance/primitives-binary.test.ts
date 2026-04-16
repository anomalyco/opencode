// Primitives.isBinary conformance.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("primitives-binary", (register) => {
  register("known binary extension short-circuits to true", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-bin-a.zip")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "plain text inside a .zip filename")
      return yield* ctx.ws.isBinary(p, 64)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe(true)
  })

  register("text file returns false", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-bin-b.ts")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "const x = 1\nexport default x\n")
      return yield* ctx.ws.isBinary(p, 30)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe(false)
  })

  register("file with NUL byte returns true via sampling", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-bin-c.dat-like")
    const bytes = new Uint8Array([65, 66, 67, 0, 68, 69, 70])
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, bytes)
      return yield* ctx.ws.isBinary(p, bytes.byteLength)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe(true)
  })
})
