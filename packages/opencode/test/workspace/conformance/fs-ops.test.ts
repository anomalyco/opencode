// Backend fs-op conformance — every Backend method is exercised once.
// On local the happy path runs; on throwing each call is expected to
// surface the THROWING_BACKEND_MARKER.

import { expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { conformance, isMarker } from "./_runner"

const enc = new TextEncoder()
const dec = new TextDecoder()

const join = (root: string, ...segs: string[]) => path.join(root, ...segs)

conformance("fs-ops", (register) => {
  register("writeFile / readFile round trip", async (ctx) => {
    const p = join(ctx.backend.rootPath, "rt.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.writeFile(p, enc.encode("hello conformance"))
      return yield* ctx.backend.readFile(p)
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(dec.decode(out as Uint8Array)).toBe("hello conformance")
  })

  register("stat returns file type/size/mtime", async (ctx) => {
    const p = join(ctx.backend.rootPath, "stat.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.writeFile(p, enc.encode("abc"))
      return yield* ctx.backend.stat(p)
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const info = out as import("../../../src/workspace/types").Workspace.FileInfo
    expect(info.type).toBe("file")
    expect(info.size).toBe(3)
    // local backend returns a Date; throwing path already returned above
    expect(info.mtime instanceof Date || info.mtime === null).toBe(true)
  })

  register("exists returns true then false", async (ctx) => {
    const p = join(ctx.backend.rootPath, "exists.txt")
    const missing = join(ctx.backend.rootPath, "nope-does-not-exist.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.writeFile(p, enc.encode("x"))
      const a = yield* ctx.backend.exists(p)
      const b = yield* ctx.backend.exists(missing)
      return [a, b] as const
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const [a, b] = out as readonly [boolean, boolean]
    expect(a).toBe(true)
    expect(b).toBe(false)
  })

  register("mkDir recursive creates nested directories", async (ctx) => {
    const d = join(ctx.backend.rootPath, "a/b/c")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.mkDir(d, { recursive: true })
      return yield* ctx.backend.stat(d)
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).type).toBe("directory")
  })

  register("readDir returns entries with types", async (ctx) => {
    const d = join(ctx.backend.rootPath, "readdir-test")
    const f = join(d, "hello.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.mkDir(d, { recursive: true })
      yield* ctx.backend.writeFile(f, enc.encode("."))
      return yield* ctx.backend.readDir(d)
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    const entries = out as Array<{ name: string; type: string }>
    const hello = entries.find((e) => e.name === "hello.txt")
    expect(hello?.type).toBe("file")
  })

  register("remove deletes a file", async (ctx) => {
    const p = join(ctx.backend.rootPath, "to-delete.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.writeFile(p, enc.encode("bye"))
      yield* ctx.backend.remove(p, { recursive: false })
      return yield* ctx.backend.exists(p)
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect(out).toBe(false)
  })

  register("rename moves a file", async (ctx) => {
    const from = join(ctx.backend.rootPath, "from.txt")
    const to = join(ctx.backend.rootPath, "to.txt")
    const eff = Effect.gen(function* () {
      yield* ctx.backend.writeFile(from, enc.encode("mv"))
      yield* ctx.backend.rename(from, to)
      const a = yield* ctx.backend.exists(from)
      const b = yield* ctx.backend.readFile(to)
      return { a, b: new TextDecoder().decode(b) } as const
    })
    const out = await ctx.expectSubstrateOrSuccess(eff)
    if (isMarker(out)) return
    expect((out as any).a).toBe(false)
    expect((out as any).b).toBe("mv")
  })

  register("writeFile does NOT create parent directories", async (ctx) => {
    // Contract: writeFile is raw. If the parent is missing we expect
    // a BackendError on local; on throwing we still expect a
    // BackendError (for the substrate marker check).
    const p = join(ctx.backend.rootPath, "missing-parent", "file.txt")
    const eff = ctx.backend.writeFile(p, enc.encode("!"))
    if (ctx.kind === "throwing") {
      const out = await ctx.expectSubstrateOrSuccess(eff)
      expect(isMarker(out)).toBe(true)
      return
    }
    // On local we expect the Effect to fail (ENOENT). Just assert a
    // BackendError exit, don't assert the specific errno.
    const exit = await Effect.runPromiseExit(eff)
    expect(exit._tag).toBe("Failure")
  })
})
