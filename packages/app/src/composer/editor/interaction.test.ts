import { expect, test } from "bun:test"
import { shouldHandlePasteAsAttachment } from "./interaction"

test("handles clipboard files, and native images only when the clipboard has no text", () => {
  expect(shouldHandlePasteAsAttachment(clipboard(), false)).toBe(false)
  expect(shouldHandlePasteAsAttachment(clipboard(), true)).toBe(true)
  expect(shouldHandlePasteAsAttachment(clipboard(["text/plain"]), true)).toBe(false)
  expect(shouldHandlePasteAsAttachment(clipboard([], [{ kind: "file" }]), false)).toBe(true)
})

function clipboard(types: string[] = [], items: Array<{ kind: string }> = []) {
  return { types, items } as unknown as DataTransfer
}
