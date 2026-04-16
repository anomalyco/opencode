// Primitives-layer fs conformance — exercises Workspace.Primitives.Service
// (not the raw Backend). All paths are under ws.rootPath.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

const enc = new TextEncoder()
const dec = new TextDecoder()

conformance("primitives-fs", (register) => {
  register("writeFile + readFile round trip via primitives", async (ctx) => {
    const root = ctx.backend.rootPath
    const p = path.posix.join(root, "prim-rt.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "hello primitives")
      return yield* ctx.ws.readFile(p)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(dec.decode(out as Uint8Array)).toBe("hello primitives")
  })

  register("readFileString returns decoded text", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-rs.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "utf8 body")
      return yield* ctx.ws.readFileString(p)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe("utf8 body")
  })

  register("stat returns file info shape", async (ctx) => {
    const p = path.posix.join(ctx.backend.rootPath, "prim-stat.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(p, "abc")
      return yield* ctx.ws.stat(p)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).type).toBe("file")
    expect((out as any).size).toBe(3)
  })

  register("exists true then false", async (ctx) => {
    const root = ctx.backend.rootPath
    const present = path.posix.join(root, "prim-exists.txt")
    const missing = path.posix.join(root, "prim-exists-nope.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(present, "x")
      const a = yield* ctx.ws.exists(present)
      const b = yield* ctx.ws.exists(missing)
      return [a, b] as const
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const [a, b] = out as readonly [boolean, boolean]
    expect(a).toBe(true)
    expect(b).toBe(false)
  })

  register("mkDir recursive + readDir", async (ctx) => {
    const d = path.posix.join(ctx.backend.rootPath, "prim-nested/a/b")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.mkDir(d, { recursive: true })
      yield* ctx.ws.writeFile(path.posix.join(d, "hi.txt"), "H")
      return yield* ctx.ws.readDir(d)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const entries = out as Array<{ name: string; type: string }>
    expect(entries.some((e) => e.name === "hi.txt" && e.type === "file")).toBe(true)
  })

  register("writeFileWithDirs creates missing parents", async (ctx) => {
    const root = ctx.backend.rootPath
    const p = path.posix.join(root, "prim-wfd/deep/tree/out.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFileWithDirs(p, "deep")
      return yield* ctx.ws.readFileString(p)
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe("deep")
  })

  register("remove + rename + isDir", async (ctx) => {
    const root = ctx.backend.rootPath
    const a = path.posix.join(root, "prim-mv-a.txt")
    const b = path.posix.join(root, "prim-mv-b.txt")
    const d = path.posix.join(root, "prim-isdir")
    const eff = Effect.gen(function* () {
      yield* ctx.ws.writeFile(a, "m")
      yield* ctx.ws.rename(a, b)
      const existedAfter = yield* ctx.ws.exists(a)
      const newExists = yield* ctx.ws.exists(b)
      yield* ctx.ws.remove(b, { recursive: false })
      yield* ctx.ws.mkDir(d, { recursive: true })
      const dirflag = yield* ctx.ws.isDir(d)
      return { existedAfter, newExists, dirflag } as const
    })
    const out = await ctx.expectWorkspaceSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const r = out as { existedAfter: boolean; newExists: boolean; dirflag: boolean }
    expect(r.existedAfter).toBe(false)
    expect(r.newExists).toBe(true)
    expect(r.dirflag).toBe(true)
  })
})
