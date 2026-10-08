import { describe, expect, test } from "bun:test"
import { createWindowRegistry } from "./registry"

function setup(initial: unknown = []) {
  const state = { stored: initial }

  const registry = createWindowRegistry<{ name: string }>({
    read: () => state.stored,
    write: (ids) => {
      state.stored = ids
    },
  })

  return { registry, state }
}

function opened(...ids: string[]) {
  const app = setup()

  for (const id of ids) app.registry.register(id, { name: id })

  return app
}

describe("window registry", () => {
  test("restores persisted ids and ignores malformed entries", () => {
    expect(setup(["a", "", 42, "b"]).registry.persisted()).toEqual(["a", "b"])
    expect(setup("junk").registry.persisted()).toEqual([])
    expect(setup(undefined).registry.persisted()).toEqual([])
  })

  test("registers each id once and forgets a deliberately closed window", () => {
    const app = opened("a", "a", "b")
    expect(app.state.stored).toEqual(["a", "b"])
    expect(app.registry.get("a")).toEqual({ name: "a" })
    expect(app.registry.get("missing")).toBeUndefined()
    expect(app.registry.closed("a")).toBe(true)
    expect(app.state.stored).toEqual(["b"])
  })

  test("keeps ids for relaunch when the last window closes or the app quits", () => {
    const last = opened("a")
    expect(last.registry.closed("a")).toBe(false)
    expect(last.state.stored).toEqual(["a"])
    expect(setup(last.state.stored).registry.persisted()).toEqual(["a"])

    const quitting = opened("a", "b")
    quitting.registry.setQuitting()
    expect(quitting.registry.closed("a")).toBe(false)
    expect(quitting.registry.closed("b")).toBe(false)
    expect(quitting.state.stored).toEqual(["a", "b"])

    // A cancelled quit (such as a failed extension restart) resumes forgetting closed windows.
    const resumed = opened("a", "b")
    resumed.registry.setQuitting()
    resumed.registry.setQuitting(false)
    expect(resumed.registry.closed("a")).toBe(true)
    expect(resumed.state.stored).toEqual(["b"])
  })

  test("tracks the last focused window and falls back on close", () => {
    const app = opened("a", "b")
    app.registry.focused("a")
    expect(app.registry.lastFocused()).toEqual({ name: "a" })
    app.registry.closed("a")
    expect(app.registry.lastFocused()).toEqual({ name: "b" })
    app.registry.closed("b")
    expect(app.registry.lastFocused()).toBeUndefined()
  })
})
