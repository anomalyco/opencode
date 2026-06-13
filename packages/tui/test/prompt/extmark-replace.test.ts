import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { TextareaRenderable } from "@opentui/core"
import { planRangeReplace } from "../../src/prompt/display"

function applyActions(input: TextareaRenderable, text: string, actions: ReturnType<typeof planRangeReplace>["actions"]) {
  for (const action of actions) {
    if (action.type === "setCursor") input.cursorOffset = action.offset
    else if (action.type === "setSelection") input.setSelection(action.start, action.end)
    else if (action.type === "insertText") input.insertText(action.value)
    else if (action.type === "clearSelection") input.clearSelection()
  }
  return input.plainText
}

describe("PromptRef.replaceRange — real TextareaRenderable extmark preservation", () => {
  test("extmark covers the suffix; after replaceRange the suffix shifts but survives", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
    try {
      const input = new TextareaRenderable(setup.renderer, { initialValue: "hello world" })
      const typeId = input.extmarks.registerType("facade-test")
      const id = input.extmarks.create({ start: 6, end: 11, typeId, virtual: true })
      expect(input.plainText).toBe("hello world")
      expect(input.extmarks.getAllForTypeId(typeId)).toHaveLength(1)

      const plan = planRangeReplace("hello world", 0, 5, "J")
      const result = applyActions(input, "hello world", plan.actions)
      expect(result).toBe("J world")

      const remaining = input.extmarks.getAllForTypeId(typeId)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(id)
      expect(remaining[0]?.start).toBe(2)
      expect(remaining[0]?.end).toBe(7)
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    }
  })

  test("pure insertion mid-text shifts downstream extmark offsets and preserves it", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
    try {
      const input = new TextareaRenderable(setup.renderer, { initialValue: "the  brown fox" })
      const typeId = input.extmarks.registerType("facade-test")
      const id = input.extmarks.create({ start: 4, end: 15, typeId, virtual: true })

      const plan = planRangeReplace("the  brown fox", 4, 4, "quick ")
      const result = applyActions(input, "the  brown fox", plan.actions)
      expect(result).toBe("the quick  brown fox")

      const remaining = input.extmarks.getAllForTypeId(typeId)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]?.id).toBe(id)
      expect(remaining[0]?.start).toBe(10)
      expect(remaining[0]?.end).toBe(21)
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    }
  })

  test("replaceRange across a plugin extmark deletes the extmark (range contains it)", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
    try {
      const input = new TextareaRenderable(setup.renderer, { initialValue: "hello world" })
      const typeId = input.extmarks.registerType("facade-test")
      input.extmarks.create({ start: 6, end: 11, typeId, virtual: true })

      const plan = planRangeReplace("hello world", 4, 11, "X")
      const result = applyActions(input, "hello world", plan.actions)
      expect(result).toBe("hellX")

      expect(input.extmarks.getAllForTypeId(typeId)).toHaveLength(0)
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    }
  })
})
