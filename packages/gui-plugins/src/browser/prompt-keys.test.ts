import { expect, test } from "bun:test"
import { cancels } from "./prompt-keys"

const key = (input: Partial<Parameters<typeof cancels>[0]>) => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  isComposing: false,
  ...input,
})

test("Escape cancels everywhere, and Command-period on macOS only", () => {
  for (const mac of [false, true]) expect(cancels(key({ key: "Escape" }), mac)).toBe(true)

  expect(cancels(key({ key: ".", metaKey: true }), true)).toBe(true)
  expect(cancels(key({ key: ".", metaKey: true }), false)).toBe(false)
  expect(cancels(key({ key: "." }), true)).toBe(false)
  expect(cancels(key({ key: ".", metaKey: true, altKey: true }), true)).toBe(false)
})

test("a key that composes text cancels nothing", () => {
  expect(cancels(key({ key: "Escape", isComposing: true }), false)).toBe(false)
})
