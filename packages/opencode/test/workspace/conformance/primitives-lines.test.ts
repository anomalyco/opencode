// Primitives.readFileLines conformance.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("primitives-lines", (register) => {
  register("readFileLines offset=1 limit=2 truncates on limit", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-lines-a.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "l1\nl2\nl3\nl4\n")
      return yield* ctx.ws.readFileLines(p, { offset: 1, limit: 2 })
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).raw).toEqual(["l1", "l2"])
    expect((out as any).more).toBe(true)
  })

  register("readFileLines offset beyond EOF returns empty raw", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-lines-b.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "only-one\n")
      return yield* ctx.ws.readFileLines(p, { offset: 10, limit: 5 })
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).raw).toEqual([])
    expect((out as any).more).toBe(false)
  })

  register("readFileLines returns more=false when file fits under limit", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-lines-c.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "a\nb\n")
      return yield* ctx.ws.readFileLines(p, { offset: 1, limit: 10 })
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).raw).toEqual(["a", "b"])
    expect((out as any).more).toBe(false)
    expect((out as any).cut).toBe(false)
  })
})
