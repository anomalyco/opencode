import { expect, test } from "bun:test"
import { createDuplicateKeyGuard } from "./key-dedupe"

const keydown = (guard: (event: KeyboardEvent) => void, key: string, mods: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...mods })
  guard(event)
  return event
}

test("blocks an identical printable keydown within the duplicate window", () => {
  const guard = createDuplicateKeyGuard()
  keydown(guard, "a")
  const duplicate = keydown(guard, "a")
  expect(duplicate.defaultPrevented).toBe(true)
})

test("keeps editing keys that are not identical, and repeats past the window", async () => {
  const guard = createDuplicateKeyGuard()
  keydown(guard, "a")
  keydown(guard, "b")
  keydown(guard, "a")
  expect(keydown(guard, "Backspace").defaultPrevented).toBe(false)
  await Bun.sleep(10)
  expect(keydown(guard, "a").defaultPrevented).toBe(false)
})

test("never blocks OS auto-repeat, IME composition or non-editing keys", async () => {
  const guard = createDuplicateKeyGuard()
  keydown(guard, "a")
  expect(keydown(guard, "a", { repeat: true }).defaultPrevented).toBe(false)
  await Bun.sleep(10)
  keydown(guard, "a")
  expect(keydown(guard, "a", { isComposing: true, key: "Process" }).defaultPrevented).toBe(false)
  expect(keydown(guard, "ArrowUp").defaultPrevented).toBe(false)
})

test("flags the editing keys that visibly double", () => {
  const guard = createDuplicateKeyGuard()
  keydown(guard, "Backspace")
  expect(keydown(guard, "Backspace").defaultPrevented).toBe(true)
  expect(keydown(guard, "Backspace").defaultPrevented).toBe(true)
})
