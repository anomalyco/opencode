import { describe, expect, test } from "bun:test"
import { createInlineEditorController } from "./inline-editor"

describe("createInlineEditorController editorKeyDown", () => {
  test("does not submit when Enter confirms IME composition", () => {
    const controller = createInlineEditorController()
    controller.openEditor("line-1", "こんにちは")

    let saved: string | undefined
    let prevented = false

    controller.editorKeyDown(
      {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as KeyboardEvent,
      (next) => {
        saved = next
      },
    )

    expect(prevented).toBe(false)
    expect(saved).toBeUndefined()
    expect(controller.editorOpen("line-1")).toBe(true)
  })

  test("submits on Enter when not composing", () => {
    const controller = createInlineEditorController()
    controller.openEditor("line-1", "  value  ")

    let saved: string | undefined
    let prevented = false

    controller.editorKeyDown(
      {
        key: "Enter",
        isComposing: false,
        keyCode: 13,
        preventDefault: () => {
          prevented = true
        },
      } as unknown as KeyboardEvent,
      (next) => {
        saved = next
      },
    )

    expect(prevented).toBe(true)
    expect(saved).toBe("value")
    expect(controller.editorOpen("line-1")).toBe(false)
  })
})
