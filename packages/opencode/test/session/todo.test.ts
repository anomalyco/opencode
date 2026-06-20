import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Todo } from "../../src/session/todo"
import { Session } from "../../src/session"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"

const root = path.join(import.meta.dirname, "../..")

function todo(overrides: Partial<Todo.Info> = {}): Todo.Info {
  return {
    content: "test todo",
    status: "pending",
    priority: "medium",
    level: 0,
    description: "",
    labels: [],
    ...overrides,
  } as Todo.Info
}

async function withSession(fn: (sessionID: string) => Promise<void>) {
  await Instance.provide({
    directory: root,
    fn: () =>
      AppRuntime.runPromise(
        Effect.gen(function* () {
          const s = yield* Session.Service
          const info = yield* s.create({ title: "test" })
          yield* Effect.promise(() => fn(info.id))
          yield* s.remove(info.id)
        }),
      ),
  })
}

describe("Todo.Service", () => {
  test("create - generates id and returns created todo", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const created = yield* svc.create({ sessionID: sessionID as any, todo: todo() })
                expect(created.id).toBeDefined()
                expect(created.content).toBe("test todo")
                expect(created.status).toBe("pending")
              }),
            ),
          ),
      })
    })
  })

  test("create - uses provided id if given", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const created = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ id: "custom-id" }),
                })
                expect(created.id).toBe("custom-id")
              }),
            ),
          ),
      })
    })
  })

  test("update - partial update changes only specified fields", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const created = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "original", status: "pending" }),
                })

                const updated = yield* svc.update({
                  sessionID: sessionID as any,
                  id: created.id!,
                  patch: { status: "in_progress", title: "new title" },
                })
                expect(updated.status).toBe("in_progress")
                expect(updated.title).toBe("new title")
                expect(updated.content).toBe("original")
              }),
            ),
          ),
      })
    })
  })

  test("update - labels field is round-tripped correctly", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const created = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "label test", labels: ["bug", "urgent"] }),
                })
                expect(created.labels).toEqual(["bug", "urgent"])

                const updated = yield* svc.update({
                  sessionID: sessionID as any,
                  id: created.id!,
                  patch: { labels: ["feature"] },
                })
                expect(updated.labels).toEqual(["feature"])
              }),
            ),
          ),
      })
    })
  })

  test("delete - removes todo", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const a = yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "a" }) })
                const b = yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "b" }) })

                yield* svc.delete({ sessionID: sessionID as any, id: a.id! })

                const all = yield* svc.get(sessionID as any)
                expect(all).toHaveLength(1)
                expect(all[0].id).toBe(b.id!)
              }),
            ),
          ),
      })
    })
  })

  test("patchStatus - updates only status field", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const created = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "patch me", status: "pending", priority: "low" }),
                })

                const patched = yield* svc.patchStatus({
                  sessionID: sessionID as any,
                  id: created.id!,
                  status: "completed",
                })
                expect(patched.status).toBe("completed")
                expect(patched.priority).toBe("low")
                expect(patched.content).toBe("patch me")
              }),
            ),
          ),
      })
    })
  })

  test("reorder - sets position by id order", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const a = yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "a" }) })
                const b = yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "b" }) })
                const c = yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "c" }) })

                yield* svc.reorder({ sessionID: sessionID as any, ids: [c.id!, a.id!, b.id!] })

                const all = yield* svc.get(sessionID as any)
                expect(all).toHaveLength(3)
                expect(all[0].id).toBe(c.id!)
                expect(all[1].id).toBe(a.id!)
                expect(all[2].id).toBe(b.id!)
              }),
            ),
          ),
      })
    })
  })

  test("getTree - returns L1 with nested L2 children", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                const l1 = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "parent", level: 0 }),
                })
                const c1 = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "child 1", level: 1, parent_id: l1.id! }),
                })
                const c2 = yield* svc.create({
                  sessionID: sessionID as any,
                  todo: todo({ content: "child 2", level: 1, parent_id: l1.id! }),
                })

                const tree = yield* svc.getTree(sessionID as any)
                expect(tree).toHaveLength(1)
                expect(tree[0].content).toBe("parent")
                expect(tree[0].children).toHaveLength(2)
                expect(tree[0].children[0].content).toBe("child 1")
                expect(tree[0].children[1].content).toBe("child 2")
              }),
            ),
          ),
      })
    })
  })

  test("replaceAll - replaces entire list", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "old" }) })

                yield* svc.replaceAll({
                  sessionID: sessionID as any,
                  todos: [todo({ content: "new 1" }), todo({ content: "new 2" })],
                })

                const all = yield* svc.get(sessionID as any)
                expect(all).toHaveLength(2)
                expect(all[0].content).toBe("new 1")
                expect(all[1].content).toBe("new 2")
              }),
            ),
          ),
      })
    })
  })

  test("get - returns todos ordered by position", async () => {
    await withSession(async (sessionID) => {
      await Instance.provide({
        directory: root,
        fn: () =>
          AppRuntime.runPromise(
            Todo.Service.use((svc) =>
              Effect.gen(function* () {
                yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "first" }) })
                yield* svc.create({ sessionID: sessionID as any, todo: todo({ content: "second" }) })

                const all = yield* svc.get(sessionID as any)
                expect(all).toHaveLength(2)
                expect(all[0].content).toBe("first")
                expect(all[1].content).toBe("second")
              }),
            ),
          ),
      })
    })
  })
})
