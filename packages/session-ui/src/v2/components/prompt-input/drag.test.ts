import { describe, expect, test } from "bun:test"
import { isPromptAttachmentDrag, PROMPT_FILE_DRAG_TYPE } from "./drag"

describe("prompt attachment drag", () => {
  test("ignores ordinary text and link drags", () => {
    expect(drag(["text/plain"])).toBe(false)
    expect(drag(["text/plain", "text/uri-list"])).toBe(false)
  })

  test("accepts files and OpenCode file tree entries", () => {
    expect(drag(["Files"])).toBe(true)
    expect(drag(["text/plain", PROMPT_FILE_DRAG_TYPE])).toBe(true)
  })
})

function drag(types: string[]) {
  return isPromptAttachmentDrag({ dataTransfer: { types } as unknown as DataTransfer })
}
