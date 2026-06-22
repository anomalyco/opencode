import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Todo } from "../../src/session/todo"
import { AutoProgress } from "../../src/session/auto-progress"
import { Session } from "../../src/session"
import { AppLayer } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"

const root = path.join(import.meta.dirname, "../..")

// Runtime with AutoProgress merged into AppLayer.
// Layer.provideMerge resolves AutoProgress.layer's Bus|Todo dependencies from AppLayer.
type TestR = AutoProgress.Service | Session.Service | Todo.Service
const rt = ManagedRuntime.make(Layer.provideMerge(AutoProgress.layer, AppLayer) as Layer.Layer<TestR, never, never>)

const run = <A>(fn: (s: { sessionID: string; todo: Todo.Interface; ap: AutoProgress.Interface }) => Effect.Effect<A>) =>
  Instance.provide({
    directory: root,
    fn: () =>
      rt.runPromise(
        Effect.gen(function* () {
          const s = yield* Session.Service
          const t = yield* Todo.Service
          const ap = yield* AutoProgress.Service
          const info = yield* s.create({ title: "auto-progress test" })
          const res = yield* fn({ sessionID: info.id, todo: t, ap })
          yield* s.remove(info.id)
          return res
        }),
      ),
  })

function fixture(overrides: Partial<Todo.Info> = {}): Todo.Info {
  return {
    content: "test",
    status: "pending",
    priority: "medium",
    level: 0,
    description: "",
    labels: [],
    ...overrides,
  } as Todo.Info
}

describe("AutoProgress", () => {
  test("L1 advances sequentially", async () => {
    await run(({ sessionID, todo, ap }) =>
      Effect.gen(function* () {
        const a = yield* todo.create({ sessionID: sessionID as any, todo: fixture({ content: "A", level: 0 }) })
        const a1 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "A1", level: 1, parent_id: a.id }),
        })
        const a2 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "A2", level: 1, parent_id: a.id }),
        })
        const b = yield* todo.create({ sessionID: sessionID as any, todo: fixture({ content: "B", level: 0 }) })
        const b1 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "B1", level: 1, parent_id: b.id }),
        })

        yield* ap.start(sessionID as any)
        yield* Effect.sleep(100)

        {
          const all = yield* todo.get(sessionID as any)
          expect(all.find((t) => t.id === a.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === a1.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === a2.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === b.id)?.status).toBe("pending")
          expect(all.find((t) => t.id === b1.id)?.status).toBe("pending")
        }

        yield* todo.patchStatus({ sessionID: sessionID as any, id: a1.id!, status: "completed" })
        yield* todo.patchStatus({ sessionID: sessionID as any, id: a2.id!, status: "completed" })
        yield* Effect.sleep(100)

        {
          const all = yield* todo.get(sessionID as any)
          expect(all.find((t) => t.id === a.id)?.status).toBe("completed")
          expect(all.find((t) => t.id === b.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === b1.id)?.status).toBe("in_progress")
        }

        yield* ap.stop(sessionID as any)
      }),
    )
  })

  test("L2 advances in parallel", async () => {
    await run(({ sessionID, todo, ap }) =>
      Effect.gen(function* () {
        const p = yield* todo.create({ sessionID: sessionID as any, todo: fixture({ content: "P", level: 0 }) })
        const c1 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "C1", level: 1, parent_id: p.id }),
        })
        const c2 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "C2", level: 1, parent_id: p.id }),
        })
        const c3 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "C3", level: 1, parent_id: p.id }),
        })

        yield* ap.start(sessionID as any)
        yield* Effect.sleep(100)

        const all = yield* todo.get(sessionID as any)
        expect(all.find((t) => t.id === p.id)?.status).toBe("in_progress")
        expect(all.find((t) => t.id === c1.id)?.status).toBe("in_progress")
        expect(all.find((t) => t.id === c2.id)?.status).toBe("in_progress")
        expect(all.find((t) => t.id === c3.id)?.status).toBe("in_progress")

        yield* ap.stop(sessionID as any)
      }),
    )
  })

  test("L1 auto-completes when all L2 children are completed", async () => {
    await run(({ sessionID, todo, ap }) =>
      Effect.gen(function* () {
        const p = yield* todo.create({ sessionID: sessionID as any, todo: fixture({ content: "X", level: 0 }) })
        const x1 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "X1", level: 1, parent_id: p.id }),
        })
        const x2 = yield* todo.create({
          sessionID: sessionID as any,
          todo: fixture({ content: "X2", level: 1, parent_id: p.id }),
        })

        yield* ap.start(sessionID as any)
        yield* Effect.sleep(100)

        {
          const all = yield* todo.get(sessionID as any)
          expect(all.find((t) => t.id === p.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === x1.id)?.status).toBe("in_progress")
          expect(all.find((t) => t.id === x2.id)?.status).toBe("in_progress")
        }

        yield* todo.patchStatus({ sessionID: sessionID as any, id: x1.id!, status: "completed" })
        yield* todo.patchStatus({ sessionID: sessionID as any, id: x2.id!, status: "completed" })
        yield* Effect.sleep(100)

        {
          const all = yield* todo.get(sessionID as any)
          expect(all.find((t) => t.id === p.id)?.status).toBe("completed")
        }

        yield* ap.stop(sessionID as any)
      }),
    )
  })
})
