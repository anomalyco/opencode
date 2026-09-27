import { expect, test } from "bun:test"
import { shouldHandlePasteAsAttachment } from "./interaction"

test("leaves paste to the browser when web clipboard data is unavailable", () => {
  expect(shouldHandlePasteAsAttachment(clipboard(), false)).toBe(false)
})

test("uses native image reading only when the clipboard has no text", () => {
  expect(shouldHandlePasteAsAttachment(clipboard(), true)).toBe(true)
  expect(shouldHandlePasteAsAttachment(clipboard(["text/plain"]), true)).toBe(false)
})

test("handles clipboard files as attachments", () => {
  expect(shouldHandlePasteAsAttachment(clipboard([], [{ kind: "file" }]), false)).toBe(true)
})

function clipboard(types: string[] = [], items: Array<{ kind: string }> = []) {
  return { types, items } as unknown as DataTransfer
}
