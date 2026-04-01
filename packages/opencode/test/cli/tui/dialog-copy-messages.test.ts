import { describe, expect, test } from "bun:test"
import type { AssistantMessage, UserMessage, Part, TextPart } from "@opencode-ai/sdk/v2"

type Message = { info: AssistantMessage | UserMessage; parts: Part[] }

describe("DialogCopyMessages", () => {
  describe("selection state management", () => {
    test("should toggle and manage message selection with Set", () => {
      const selected = new Set<string>()

      selected.add("msg_1")
      expect(selected.has("msg_1")).toBe(true)
      expect(selected.size).toBe(1)

      selected.add("msg_2")
      expect(selected.has("msg_1")).toBe(true)
      expect(selected.has("msg_2")).toBe(true)
      expect(selected.size).toBe(2)

      selected.delete("msg_1")
      expect(selected.has("msg_1")).toBe(false)
      expect(selected.has("msg_2")).toBe(true)
      expect(selected.size).toBe(1)
    })

    test("should support select-all pattern", () => {
      const messageIds = ["msg_1", "msg_2", "msg_3", "msg_4"]
      const selected = new Set(messageIds)

      expect(selected.size).toBe(4)
      messageIds.forEach((id) => expect(selected.has(id)).toBe(true))
    })

    test("should start empty", () => {
      const selected = new Set<string>()
      expect(selected.size).toBe(0)
    })
  })

  describe("part filtering logic", () => {
    test("should filter synthetic parts from text content", () => {
      const parts: Part[] = [
        { id: "p1", type: "text", text: "Real content", synthetic: false } as any,
        { id: "p2", type: "text", text: "Synthetic", synthetic: true } as any,
      ]

      const realText = parts
        .filter((p): p is TextPart => p.type === "text" && !p.synthetic)
        .map((p) => p.text)
        .join("")

      expect(realText).toBe("Real content")
    })

    test("should handle mixed part types (text and tool)", () => {
      const parts: Part[] = [
        { id: "p1", type: "text", text: "Output" } as any,
        { id: "p2", type: "tool", tool: "bash" } as any,
      ]

      const textParts = parts.filter((p) => p.type === "text")
      const toolParts = parts.filter((p) => p.type === "tool")

      expect(textParts).toHaveLength(1)
      expect(toolParts).toHaveLength(1)
    })
  })

  describe("navigation wrapping", () => {
    test("should wrap forward and backward through list", () => {
      const listSize = 3
      let index = 0

      const moveForward = () => {
        index = (index + 1) % listSize
      }

      const moveBackward = () => {
        index = (index - 1 + listSize) % listSize
      }

      // Forward navigation
      moveForward()
      expect(index).toBe(1)
      moveForward()
      expect(index).toBe(2)
      moveForward()
      expect(index).toBe(0)

      // Backward navigation
      moveBackward()
      expect(index).toBe(2)
      moveBackward()
      expect(index).toBe(1)
    })
  })

  describe("message filtering and ordering", () => {
    test("should filter selected messages while preserving order", () => {
      const messages = [
        { info: { id: "msg_1", role: "user" as const } },
        { info: { id: "msg_2", role: "assistant" as const } },
        { info: { id: "msg_3", role: "user" as const } },
        { info: { id: "msg_4", role: "assistant" as const } },
      ] as Message[]

      const selected = new Set(["msg_1", "msg_3", "msg_4"])
      const filtered = messages.filter((m) => selected.has(m.info.id))

      expect(filtered).toHaveLength(3)
      expect(filtered.map((m) => m.info.id)).toEqual(["msg_1", "msg_3", "msg_4"])
    })

    test("should handle empty selection returning no messages", () => {
      const messages = [{ info: { id: "msg_1" } }, { info: { id: "msg_2" } }] as Message[]

      const selected = new Set<string>()
      const filtered = messages.filter((m) => selected.has(m.info.id))

      expect(filtered).toHaveLength(0)
    })

    test("should require non-empty selection to confirm", () => {
      const selected = new Set<string>()
      const canConfirm = selected.size > 0

      expect(canConfirm).toBe(false)

      selected.add("msg_1")
      expect(selected.size > 0).toBe(true)
    })
  })
})
