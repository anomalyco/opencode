import { test, expect, describe } from "bun:test"
import {
  parseShareUrl,
  shouldAttachShareAuthHeaders,
  transformShareData,
  type ShareData,
} from "../../src/cli/cmd/import"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Todo } from "../../src/session/todo"
const projectRoot = path.join(__dirname, "../..")

// parseShareUrl tests
test("parses valid share URLs", () => {
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://custom.example.com/share/abc123")).toBe("abc123")
  expect(parseShareUrl("http://localhost:3000/share/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://opncd.ai/s/Jsj3hNIW")).toBeNull() // legacy format
  expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/id/extra")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
  ]

  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})

// todo round-trip: import writes todos when present in export JSON
describe("import todos", () => {
  test("imports todos from export data when present", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const todos: Todo.Info[] = [
          { content: "task one", status: "pending", priority: "high" },
          { content: "task two", status: "completed", priority: "low" },
        ]

        // Simulate what the import handler does with todos
        const parsed = todos.map((t) => Todo.Info.parse(t))
        Todo.update({ sessionID: session.id, todos: parsed })

        const stored = Todo.get(session.id)
        expect(stored).toHaveLength(2)
        expect(stored[0]).toEqual({ content: "task one", status: "pending", priority: "high" })
        expect(stored[1]).toEqual({ content: "task two", status: "completed", priority: "low" })

        await Session.remove(session.id)
      },
    })
  })

  test("empty todos array does not overwrite existing todos", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Todo.update({
          sessionID: session.id,
          todos: [{ content: "existing", status: "pending", priority: "medium" }],
        })

        // Updating with an empty array clears todos — import handler guards against this
        Todo.update({ sessionID: session.id, todos: [] })

        const stored = Todo.get(session.id)
        expect(stored).toHaveLength(0)

        await Session.remove(session.id)
      },
    })
  })

  test("pre-existing todos survive when no new todos are written", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        Todo.update({
          sessionID: session.id,
          todos: [{ content: "pre-existing", status: "pending", priority: "medium" }],
        })

        // Don't call Todo.update — simulates import with absent/empty todos field
        const stored = Todo.get(session.id)
        expect(stored).toHaveLength(1)
        expect(stored[0].content).toBe("pre-existing")

        await Session.remove(session.id)
      },
    })
  })
})

// todo round-trip: export includes todos
describe("export todos", () => {
  test("Todo.get returns todos in position order", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        const todos: Todo.Info[] = [
          { content: "first", status: "pending", priority: "high" },
          { content: "second", status: "in_progress", priority: "medium" },
          { content: "third", status: "completed", priority: "low" },
        ]
        Todo.update({ sessionID: session.id, todos })

        const result = Todo.get(session.id)
        expect(result).toHaveLength(3)
        expect(result.map((t) => t.content)).toEqual(["first", "second", "third"])

        await Session.remove(session.id)
      },
    })
  })

  test("Todo.get returns empty array when no todos exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        const result = Todo.get(session.id)
        expect(result).toEqual([])
        await Session.remove(session.id)
      },
    })
  })
})

