import { expect, test } from "bun:test"
import { Schema } from "effect"
import { createRefs, documentRefs, RefsStore } from "./refs"

test("a long-lived document evicts its oldest refs from both lookups", () => {
  const refs = documentRefs()
  refs.add("first", undefined, new Map([["e1", 10]]))
  refs.add("second", "session", new Map(Array.from({length:10_000}, (_, i) => [`e${i+2}`, i+1])))
  expect(refs.get("e1")).toBeUndefined()
  expect(refs.previous("first").size).toBe(0)
  expect(refs.previous("second", "session").size).toBe(10_000)
  expect(refs.get("e2")?.backendID).toBe(1)
})

/** Main storage's row for the store, as its schema encodes it. */
type Disk = { stored?: number }

test("element refs stay unique when the pane's main entry reloads over the same storage", () => {
  const values: Disk = {}
  const declared = RefsStore

  // The store as main storage opens it on each load: each value kept as its schema encodes it.
  const open = () => {
    const read = () =>
      "stored" in values ? Schema.decodeUnknownSync(declared.schema)(values.stored) : declared.initial

    return {
      get value() {
        return read()
      },
      ready: () => true,
      update: (mutate: (draft: number) => void) => mutate(read()),
      set: (next: number) => void (values.stored = Schema.encodeUnknownSync(declared.schema)(next)),
    }
  }

  const before = createRefs(open())
  const issued = [before(), before()]
  const after = createRefs(open())
  expect(issued).toEqual(["e1", "e2"])
  expect(issued).not.toContain(after())
})
