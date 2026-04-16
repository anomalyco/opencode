// Primitives.search() conformance. Depends on `rg` being available in
// the backend — host PATH on local, snapshot image on vercel.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

conformance("primitives-search", (register) => {
  register("search finds matches in a fixture tree", async (ctx) => {
    const root = ctx.backend.rootPath
    const dir = path.posix.join(root, "prim-search-tree")
    const a = path.posix.join(dir, "a.txt")
    const b = path.posix.join(dir, "b.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.mkDir(dir, { recursive: true })
      yield* ctx.ws.writeFile(a, "hello SEARCH_NEEDLE world\n")
      yield* ctx.ws.writeFile(b, "no trace here\n")
      const result = yield* ctx.ws.search({ cwd: dir, pattern: "SEARCH_NEEDLE" })
      yield* ctx.ws.remove(dir, { recursive: true })
      return result
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as unknown as { items: Array<{ lineText: string; path: string }>; partial: boolean }
    expect(r.items.length).toBeGreaterThanOrEqual(1)
    expect(r.items[0].lineText).toContain("SEARCH_NEEDLE")
    expect(r.partial).toBe(false)
  })

  register("search with no matches returns empty items and partial=false", async (ctx) => {
    const dir = path.posix.join(ctx.backend.rootPath, "prim-search-empty")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.mkDir(dir, { recursive: true })
      yield* ctx.ws.writeFile(path.posix.join(dir, "x.txt"), "just plain text\n")
      const result = yield* ctx.ws.search({
        cwd: dir,
        pattern: "SURELY_NOT_PRESENT_XYZ",
      })
      yield* ctx.ws.remove(dir, { recursive: true })
      return result
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { items: unknown[]; partial: boolean }
    expect(r.items.length).toBe(0)
    expect(r.partial).toBe(false)
  })
})
