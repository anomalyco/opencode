import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createLayoutPanelController, createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./layout"

describe("layout session-key helpers", () => {
  test("couples touch and scroll seed in order", () => {
    const calls: string[] = []
    const result = ensureSessionKey(
      "dir/a",
      (key) => calls.push(`touch:${key}`),
      (key) => calls.push(`seed:${key}`),
    )

    expect(result).toBe("dir/a")
    expect(calls).toEqual(["touch:dir/a", "seed:dir/a"])
  })

  test("reads dynamic accessor keys lazily", () => {
    const seen: string[] = []

    createRoot((dispose) => {
      const [key, setKey] = createSignal("dir/one")
      const read = createSessionKeyReader(key, (value) => seen.push(value))

      expect(read()).toBe("dir/one")
      setKey("dir/two")
      expect(read()).toBe("dir/two")

      dispose()
    })

    expect(seen).toEqual(["dir/one", "dir/two"])
  })
})

describe("createLayoutPanelController", () => {
  test("exposes opened, open, close, and toggle around one boolean state", () => {
    createRoot((dispose) => {
      const [opened, setOpened] = createSignal(false)
      const panel = createLayoutPanelController(opened, setOpened)

      expect(panel.opened()).toBe(false)
      panel.open()
      expect(panel.opened()).toBe(true)
      panel.toggle()
      expect(panel.opened()).toBe(false)
      panel.close()
      expect(panel.opened()).toBe(false)

      dispose()
    })
  })

  test("supports the browserPanel header toggle contract", () => {
    createRoot((dispose) => {
      const [browserPanelOpened, setBrowserPanelOpened] = createSignal(false)
      const browserPanel = createLayoutPanelController(browserPanelOpened, setBrowserPanelOpened)

      expect(browserPanel.opened()).toBe(false)
      browserPanel.toggle()
      expect(browserPanel.opened()).toBe(true)
      browserPanel.toggle()
      expect(browserPanel.opened()).toBe(false)

      dispose()
    })
  })
})

describe("pruneSessionKeys", () => {
  test("keeps active key and drops lowest-used keys", () => {
    const drop = pruneSessionKeys({
      keep: "k4",
      max: 3,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
        ["k3", 3],
        ["k4", 4],
      ]),
      view: ["k1", "k2", "k4"],
      tabs: ["k1", "k3", "k4"],
    })

    expect(drop).toEqual(["k1"])
    expect(drop.includes("k4")).toBe(false)
  })

  test("does not prune without keep key", () => {
    const drop = pruneSessionKeys({
      keep: undefined,
      max: 1,
      used: new Map([
        ["k1", 1],
        ["k2", 2],
      ]),
      view: ["k1"],
      tabs: ["k2"],
    })

    expect(drop).toEqual([])
  })
})
