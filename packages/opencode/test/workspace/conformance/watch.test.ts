/**
 * watch() conformance tests.
 *
 * Local: @parcel/watcher fires add/change/unlink within ~50ms of the
 * underlying fs-op. Throwing: the Stream itself fails immediately with
 * the marker. Vercel: polling watcher round-trips through the sandbox
 * API; `ctx.watchTimeoutMs` is widened accordingly.
 *
 * All temp directories are created under `ctx.backend.rootPath` via
 * `backend.mkDir` so the tests are substrate-agnostic — no `os.tmpdir()`
 * host paths leak across the Backend seam.
 */
import { expect } from "bun:test"
import { Effect, Exit, Fiber, Option, Stream } from "effect"
import path from "node:path"
import { conformance } from "./_runner"
import type { Workspace } from "../../../src/workspace/types"
import { THROWING_BACKEND_MARKER } from "../../../src/workspace/testing/throwing-backend"

const enc = new TextEncoder()

const collectUpTo = <E>(
  stream: Stream.Stream<Workspace.FsEvent, E>,
  n: number,
  ms: number,
): Effect.Effect<Workspace.FsEvent[], E> =>
  Stream.runCollect(stream.pipe(Stream.take(n))).pipe(
    Effect.timeoutOption(`${ms} millis`),
    Effect.map((opt) => (Option.isSome(opt) ? opt.value : ([] as Workspace.FsEvent[]))),
  )

let dirSeq = 0
const makeDir = async (backend: Workspace.Backend, label: string): Promise<string> => {
  const name = `watch-${label}-${Date.now()}-${++dirSeq}`
  const dir = path.posix.join(backend.rootPath, name)
  await Effect.runPromise(backend.mkDir(dir, { recursive: true }))
  return dir
}

const removeDir = async (backend: Workspace.Backend, dir: string): Promise<void> => {
  await Effect.runPromise(backend.remove(dir, { recursive: true }).pipe(Effect.ignore))
}

conformance("watch", (register) => {
  register("fires an add event when a file is created", async (ctx) => {
    if (ctx.kind === "throwing") {
      const exit = await Effect.runPromiseExit(Stream.runDrain(ctx.backend.watch("/throwing")))
      if (Exit.isSuccess(exit)) {
        throw new Error("expected throwing backend watch stream to fail")
      }
      const repr = JSON.stringify(exit.cause)
      expect(repr.includes(THROWING_BACKEND_MARKER)).toBe(true)
      return
    }

    const dir = await makeDir(ctx.backend, "add")
    try {
      const target = path.posix.join(dir, "new.txt")
      const eff = Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(collectUpTo(ctx.backend.watch(dir), 1, ctx.watchTimeoutMs))
          yield* Effect.sleep("500 millis")
          yield* ctx.backend.writeFile(target, enc.encode("hello"))
          return yield* Fiber.join(fiber)
        }),
      )
      const events = await Effect.runPromise(eff)
      const names = events.map((e) => `${e.type}:${path.posix.basename(e.path)}`)
      expect(names.some((n) => n.startsWith("add:"))).toBe(true)
    } finally {
      await removeDir(ctx.backend, dir)
    }
  })

  register("fires a change event when a file is modified", async (ctx) => {
    if (ctx.kind === "throwing") {
      const exit = await Effect.runPromiseExit(Stream.runDrain(ctx.backend.watch("/throwing")))
      if (Exit.isSuccess(exit)) {
        throw new Error("expected throwing backend watch stream to fail")
      }
      const repr = JSON.stringify(exit.cause)
      expect(repr.includes(THROWING_BACKEND_MARKER)).toBe(true)
      return
    }

    const dir = await makeDir(ctx.backend, "change")
    try {
      const target = path.posix.join(dir, "m.txt")
      await Effect.runPromise(ctx.backend.writeFile(target, enc.encode("v1")))
      const eff = Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(collectUpTo(ctx.backend.watch(dir), 1, ctx.watchTimeoutMs))
          yield* Effect.sleep("500 millis")
          yield* ctx.backend.writeFile(target, enc.encode("v2-modified"))
          return yield* Fiber.join(fiber)
        }),
      )
      const events = await Effect.runPromise(eff)
      expect(events.some((e) => e.type === "change" || e.type === "add")).toBe(true)
    } finally {
      await removeDir(ctx.backend, dir)
    }
  })

  register("fires an unlink event when a file is removed", async (ctx) => {
    if (ctx.kind === "throwing") {
      const exit = await Effect.runPromiseExit(Stream.runDrain(ctx.backend.watch("/throwing")))
      if (Exit.isSuccess(exit)) {
        throw new Error("expected throwing backend watch stream to fail")
      }
      const repr = JSON.stringify(exit.cause)
      expect(repr.includes(THROWING_BACKEND_MARKER)).toBe(true)
      return
    }

    const dir = await makeDir(ctx.backend, "unlink")
    try {
      const target = path.posix.join(dir, "u.txt")
      await Effect.runPromise(ctx.backend.writeFile(target, enc.encode("bye")))
      // @parcel/watcher's fs-events backend can coalesce rapid
      // create+delete into a single event. Wait for the file to
      // stabilise before subscribing so the remove is unambiguous.
      await new Promise((r) => setTimeout(r, 600))
      const eff = Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(collectUpTo(ctx.backend.watch(dir), 1, ctx.watchTimeoutMs))
          yield* Effect.sleep("500 millis")
          yield* ctx.backend.remove(target, { recursive: false })
          return yield* Fiber.join(fiber)
        }),
      )
      const events = await Effect.runPromise(eff)
      expect(events.some((e) => e.type === "unlink")).toBe(true)
    } finally {
      await removeDir(ctx.backend, dir)
    }
  })
})
