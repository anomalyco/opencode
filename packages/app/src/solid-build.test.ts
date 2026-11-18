import { expect, test } from "bun:test"
import { createMemo, createRoot, createSignal } from "solid-js"

// The unit runner has to load solid-js's client build. `--conditions=solid` matches no export in solid-js, so bun
// resolves `node` and loads `dist/server.js`, where memos and effects never re-run: a reactive test then proves
// nothing. This fails on that build and passes on the client one.
test("memos update in the unit runner", () => {
  createRoot((dispose) => {
    const [value, setValue] = createSignal(1)
    const double = createMemo(() => value() * 2)

    expect(double()).toBe(2)
    setValue(2)
    expect(double()).toBe(4)
    dispose()
  })
})
