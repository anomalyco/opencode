import { expect, test } from "bun:test"
import { Schema } from "effect"
import browser from "./index"
import { createRefs } from "./refs"

/** Main storage's row for the store, as its schema encodes it. */
type Disk = { stored?: number }

test("element refs stay unique when the pane's main entry reloads over the same storage", () => {
  const values: Disk = {}
  const declared = browser.stores.refs

  // The declared store as the host opens it on each load: each value kept as its schema encodes it.
  const open = () => {
    const read = () =>
      "stored" in values ? Schema.decodeUnknownSync(declared.schema)(values.stored) : declared.initial

    return {
      get value() {
        return read()
      },
      ready: () => true,
      // Like the host's: a mutation that returns a value replaces the stored one.
      update: (mutation: (draft: number) => number | void) => {
        const current = read()
        const next = mutation(current)

        values.stored = Schema.encodeUnknownSync(declared.schema)(next === undefined ? current : next)
      },
    }
  }

  const before = createRefs(open())
  const issued = [before(), before()]
  const after = createRefs(open())
  expect(issued).toEqual(["e1", "e2"])
  expect(issued).not.toContain(after())
})
