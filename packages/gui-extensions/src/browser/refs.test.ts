import { expect, test } from "bun:test"
import type { MainStorage } from "../sdk/main"
import { createRefs } from "./refs"

test("element refs stay unique when the pane's main entry reloads over the same storage", () => {
  const values = new Map<string, unknown>()
  const storage = {
    store: (key: string, options: { initial: unknown }) => ({
      get: () => (values.has(key) ? values.get(key) : options.initial),
      set: (value: unknown) => values.set(key, value),
      remove: () => values.delete(key),
    }),
  } as unknown as MainStorage
  const before = createRefs(storage)
  const issued = [before(), before()]
  const after = createRefs(storage)
  expect(issued).toEqual(["e1", "e2"])
  expect(issued).not.toContain(after())
})
