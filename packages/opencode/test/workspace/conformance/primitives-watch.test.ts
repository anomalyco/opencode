// Primitives.watch() conformance. Mirrors watch.test.ts but routes
// through ctx.ws.watch to exercise the WorkspaceError mapping layer.

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
const makeDir = async (ws: { mkDir: (p: string, opts: { recursive: boolean }) => Effect.Effect<void, any> }, root: string, label: string): Promise<string> => {
  const name = `pws-watch-${label}-${Date.now()}-${++dirSeq}`
  const dir = path.posix.join(root, name)
  await Effect.runPromise(ws.mkDir(dir, { recursive: true }))
  return dir
}

conformance("primitives-watch", (register) => {
  register("primitives watch fires an add event after write", async (ctx) => {
    if (ctx.kind === "throwing") {
      const exit = await Effect.runPromiseExit(Stream.runDrain(ctx.ws.watch("/throwing")))
      if (Exit.isSuccess(exit)) {
        throw new Error("expected throwing-backend watch stream to fail through primitives")
      }
      const repr = JSON.stringify(exit.cause)
      expect(repr.includes(THROWING_BACKEND_MARKER)).toBe(true)
      return
    }

    const dir = await makeDir(ctx.ws, ctx.backend.rootPath, "add")
    try {
      const target = path.posix.join(dir, "new.txt")
      const eff = Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(collectUpTo(ctx.ws.watch(dir), 1, ctx.watchTimeoutMs))
          yield* Effect.sleep("500 millis")
          yield* ctx.ws.writeFile(target, enc.encode("hi"))
          return yield* Fiber.join(fiber)
        }),
      )
      const events = await Effect.runPromise(eff)
      expect(events.some((e) => e.type === "add" || e.type === "change")).toBe(true)
    } finally {
      await Effect.runPromise(ctx.ws.remove(dir, { recursive: true }).pipe(Effect.ignore))
    }
  })
})
