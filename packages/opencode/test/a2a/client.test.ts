import { describe, expect, test } from "bun:test"
import { transformStreamEvent, clearClientCache } from "../../src/a2a/client"
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from "@a2a-js/sdk"

describe("a2a.client", () => {
  describe("transformStreamEvent", () => {
    test("transforms Task to task event", () => {
      const task: Task = {
        kind: "task",
        id: "task-1",
        contextId: "ctx-1",
        status: { state: "completed" },
        artifacts: [],
      }

      const event = transformStreamEvent(task)

      expect(event).not.toBeNull()
      expect(event?.type).toBe("task")
      if (event?.type === "task") {
        expect(event.task.id).toBe("task-1")
        expect(event.task.contextId).toBe("ctx-1")
      }
    })

    test("transforms Message to message event with concatenated text", () => {
      const message: Message = {
        kind: "message",
        messageId: "msg-1",
        role: "agent",
        contextId: "ctx-1",
        parts: [
          { kind: "text", text: "Hello " },
          { kind: "text", text: "World" },
        ],
      }

      const event = transformStreamEvent(message)

      expect(event).not.toBeNull()
      expect(event?.type).toBe("message")
      if (event?.type === "message") {
        expect(event.text).toBe("Hello World")
        expect(event.contextId).toBe("ctx-1")
      }
    })

    test("transforms Message with missing contextId", () => {
      const message: Message = {
        kind: "message",
        messageId: "msg-1",
        role: "agent",
        parts: [{ kind: "text", text: "Hi" }],
      }

      const event = transformStreamEvent(message)

      expect(event?.type).toBe("message")
      if (event?.type === "message") {
        expect(event.contextId).toBe("")
      }
    })

    test("transforms Message with non-text parts (filters to text only)", () => {
      const message: Message = {
        kind: "message",
        messageId: "msg-1",
        role: "agent",
        contextId: "ctx-1",
        parts: [
          { kind: "text", text: "Text part" },
          { kind: "data", data: { foo: "bar" } },
          { kind: "text", text: " more text" },
        ],
      }

      const event = transformStreamEvent(message)

      expect(event?.type).toBe("message")
      if (event?.type === "message") {
        expect(event.text).toBe("Text part more text")
      }
    })

    test("transforms TaskStatusUpdateEvent to statusUpdate event", () => {
      const statusUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        status: {
          state: "working",
          message: {
            kind: "message",
            messageId: "msg-status",
            role: "agent",
            parts: [{ kind: "text", text: "Processing..." }],
          },
        },
        final: false,
      }

      const event = transformStreamEvent(statusUpdate)

      expect(event).not.toBeNull()
      expect(event?.type).toBe("statusUpdate")
      if (event?.type === "statusUpdate") {
        expect(event.taskId).toBe("task-1")
        expect(event.contextId).toBe("ctx-1")
        expect(event.state).toBe("working")
        expect(event.message).toBe("Processing...")
        expect(event.final).toBe(false)
      }
    })

    test("transforms TaskStatusUpdateEvent without message", () => {
      const statusUpdate: TaskStatusUpdateEvent = {
        kind: "status-update",
        taskId: "task-1",
        contextId: "ctx-1",
        status: { state: "completed" },
        final: true,
      }

      const event = transformStreamEvent(statusUpdate)

      expect(event?.type).toBe("statusUpdate")
      if (event?.type === "statusUpdate") {
        expect(event.state).toBe("completed")
        expect(event.message).toBeUndefined()
        expect(event.final).toBe(true)
      }
    })

    test("transforms TaskArtifactUpdateEvent to artifact event", () => {
      const artifactUpdate: TaskArtifactUpdateEvent = {
        kind: "artifact-update",
        taskId: "task-1",
        contextId: "ctx-1",
        artifact: {
          artifactId: "art-1",
          name: "response",
          parts: [{ kind: "text", text: "Result" }],
        },
      }

      const event = transformStreamEvent(artifactUpdate)

      expect(event).not.toBeNull()
      expect(event?.type).toBe("artifact")
      if (event?.type === "artifact") {
        expect(event.taskId).toBe("task-1")
        expect(event.contextId).toBe("ctx-1")
        expect(event.artifact.artifactId).toBe("art-1")
        expect(event.artifact.name).toBe("response")
      }
    })

    test("returns null for unknown event types", () => {
      const unknown = { kind: "unknown" } as any

      const event = transformStreamEvent(unknown)

      expect(event).toBeNull()
    })
  })

  describe("clearClientCache", () => {
    test("clears without error", () => {
      expect(() => clearClientCache()).not.toThrow()
    })
  })
})
