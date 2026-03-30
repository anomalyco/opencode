import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, type SessionID } from "../../src/session/schema"
import { Todo } from "../../src/session/todo"
import { Log } from "../../src/util/log"

const root = path.join(__dirname, "../..")
Log.init({ print: false })

// Helper: create a session with user+assistant messages (simulates bash tool context)
async function makeMsg(sessionID: SessionID) {
  // Create user message first (assistant needs parentID)
  const userID = MessageID.ascending()
  await Session.updateMessage({
    id: userID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)

  const assistantID = MessageID.ascending()
  await Session.updateMessage({
    id: assistantID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: userID,
    agent: "build",
    modelID: "test-model",
    providerID: "test",
    mode: "",
    path: { cwd: root, root },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as MessageV2.Info)
  return assistantID
}

describe("oc — /session/:id/tool endpoint", () => {
  test("executes a tool and returns output", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "glob", args: { pattern: "*.ts" } }),
        })
        expect(res.status).toBe(200)
        const text = await res.text()
        // Should return some .ts files from the project root
        expect(text.length).toBeGreaterThan(0)

        await Session.remove(session.id)
      },
    })
  })

  test("returns 404 for unknown tool", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "nonexistent_tool_xyz", args: {} }),
        })
        expect(res.status).toBe(404)

        await Session.remove(session.id)
      },
    })
  })

  test("creates ToolPart when messageID provided", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const msgID = await makeMsg(session.id)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "glob",
            args: { pattern: "package.json" },
            messageID: msgID,
          }),
        })
        expect(res.status).toBe(200)
        await res.text() // consume stream — ToolPart update happens inside

        // Check that a ToolPart was created on the message
        const parts = await MessageV2.parts(msgID)
        const ocParts = parts.filter((p): p is MessageV2.ToolPart => p.type === "tool" && !!p.metadata?.oc)
        expect(ocParts.length).toBe(1)
        expect(ocParts[0].tool).toBe("glob")
        expect(ocParts[0].state.status).toBe("completed")

        await Session.remove(session.id)
      },
    })
  })

  test("does NOT create ToolPart without messageID", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const msgID = await makeMsg(session.id)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/tool`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "glob", args: { pattern: "package.json" } }),
        })
        expect(res.status).toBe(200)

        // No oc ToolParts should be created
        const parts = await MessageV2.parts(msgID)
        const ocParts = parts.filter((p): p is MessageV2.ToolPart => p.type === "tool" && !!p.metadata?.oc)
        expect(ocParts.length).toBe(0)

        await Session.remove(session.id)
      },
    })
  })

  // Note: tool error tests skipped because tools ask for permissions which
  // hang in test context. Error handling is tested via CLI tests in dacmicu.test.ts.

  test("binary file pass-through appends OC_FILE marker for PDF", async () => {
    // Create the PDF inside the project dir so it passes the read tool's
    // containsPath check — external files block on an interactive permission ask.
    const tmpFile = path.join(root, `oc-test-${Date.now()}.pdf`)
    await Bun.write(tmpFile, "%PDF-1.4 test content")
    try {
      await Instance.provide({
        directory: root,
        fn: async () => {
          const session = await Session.create({})
          const app = Server.Default()

          const res = await app.request(`/session/${session.id}/tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "read",
              args: { filePath: tmpFile },
            }),
          })
          expect(res.status).toBe(200)
          const text = await res.text()
          // PDF files return "PDF read successfully" + OC_FILE marker
          expect(text).toContain("PDF read successfully")
          expect(text).toContain("\x00OC_FILE\x00:")
          expect(text).toContain(tmpFile)

          await Session.remove(session.id)
        },
      })
    } finally {
      await fs.unlink(tmpFile).catch(() => {})
    }
  })
})

describe("oc — exec schema validation", () => {
  test("exec endpoint rejects missing prompt field", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system: "only system, no prompt" }),
        })
        expect(res.status).toBe(400)

        await Session.remove(session.id)
      },
    })
  })

  test("exec endpoint accepts optional format field with json_schema type", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        // Schema validation: the format field is optional; providing it should not cause 400.
        // The request will fail beyond validation (no model configured), but must not be 400.
        const res = await app.request(`/session/${session.id}/exec`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "test",
            format: {
              type: "json_schema",
              schema: { type: "object", properties: { result: { type: "boolean" } } },
            },
          }),
        })
        expect(res.status).not.toBe(400)

        await Session.remove(session.id)
      },
    })
  })
})

describe("oc — todo endpoints", () => {
  test("POST creates a todo", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/todo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Test task", status: "pending" }),
        })
        expect(res.status).toBe(200)
        const todo = await res.json()
        expect(todo.content).toBe("Test task")
        expect(todo.status).toBe("pending")
        expect(todo.priority).toBe("medium")

        // Verify it's in the list
        const todos = Todo.get(session.id)
        expect(todos.length).toBe(1)

        await Session.remove(session.id)
      },
    })
  })

  test("PUT replaces all todos", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})
        const app = Server.Default()

        // Add 2 todos
        Todo.update({ sessionID: session.id, todos: [{ content: "Task 1", status: "pending", priority: "medium" }] })
        Todo.update({
          sessionID: session.id,
          todos: [...Todo.get(session.id), { content: "Task 2", status: "pending", priority: "medium" }],
        })
        expect(Todo.get(session.id).length).toBe(2)

        // Replace with 1 todo
        const res = await app.request(`/session/${session.id}/todo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ todos: [{ content: "Replaced", status: "completed", priority: "high" }] }),
        })
        expect(res.status).toBe(200)
        const todos = Todo.get(session.id)
        expect(todos.length).toBe(1)
        expect(todos[0].content).toBe("Replaced")
        expect(todos[0].status).toBe("completed")

        await Session.remove(session.id)
      },
    })
  })

  test("Todo.update supports incremental additions", async () => {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const session = await Session.create({})

        // Add 10 todos incrementally
        for (let i = 0; i < 10; i++) {
          const existing = Todo.get(session.id)
          Todo.update({
            sessionID: session.id,
            todos: [...existing, { content: `Task ${i}`, status: "pending", priority: "medium" }],
          })
        }

        const todos = Todo.get(session.id)
        expect(todos.length).toBe(10)
        // Verify ordering is preserved
        expect(todos[0].content).toBe("Task 0")
        expect(todos[9].content).toBe("Task 9")

        await Session.remove(session.id)
      },
    })
  })
})
