import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("session todo routes", () => {
  test("POST /todo appends a todo item", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Fix bug", status: "pending", priority: "high" }),
        })

        expect(res.status).toBe(200)
        const todos = await res.json()
        expect(todos).toHaveLength(1)
        expect(todos[0].content).toBe("Fix bug")
        expect(todos[0].status).toBe("pending")
        expect(todos[0].priority).toBe("high")

        // Verify persisted
        const stored = await Todo.get(session.id)
        expect(stored).toHaveLength(1)
        expect(stored[0].content).toBe("Fix bug")

        await Session.remove(session.id)
      },
    })
  })

  test("POST /todo appends to existing todos", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "First", status: "completed", priority: "high" }),
        })

        const res = await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Second", status: "pending", priority: "medium" }),
        })

        expect(res.status).toBe(200)
        const todos = await res.json()
        expect(todos).toHaveLength(2)
        expect(todos[0].content).toBe("First")
        expect(todos[1].content).toBe("Second")

        await Session.remove(session.id)
      },
    })
  })

  test("PUT /todo replaces all todos", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        // Seed with one todo
        await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Old", status: "pending", priority: "low" }),
        })

        // Replace with two new todos
        const res = await app.request(`/session/${session.id}/todo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            todos: [
              { content: "New A", status: "in_progress", priority: "high" },
              { content: "New B", status: "pending", priority: "medium" },
            ],
          }),
        })

        expect(res.status).toBe(200)
        const todos = await res.json()
        expect(todos).toHaveLength(2)
        expect(todos[0].content).toBe("New A")
        expect(todos[1].content).toBe("New B")

        // Verify "Old" is gone
        const stored = await Todo.get(session.id)
        expect(stored).toHaveLength(2)
        expect(stored.find((t: any) => t.content === "Old")).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("POST /todo rejects invalid body", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Missing fields" }),
        })

        expect(res.status).toBe(400)

        await Session.remove(session.id)
      },
    })
  })
})
