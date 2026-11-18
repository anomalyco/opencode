import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSelectedEffect } from "../src/session/timeline/selected-effect"

test("a detached view syncs nothing, then once on selection if its source changed meanwhile", () => {
  const [source, setSource] = createSignal("/repo")
  const [active, setActive] = createSignal(true)
  const runs: string[] = []

  const dispose = createRoot((dispose) => {
    createSelectedEffect(source, active, (value) => runs.push(value))

    return dispose
  })

  try {
    expect(runs).toEqual(["/repo"])

    setSource("/repo/a")
    expect(runs).toEqual(["/repo", "/repo/a"])

    setActive(false)
    setActive(true)
    expect(runs).toEqual(["/repo", "/repo/a"])

    setActive(false)
    setSource("/repo/b")
    setSource("/repo/c")
    expect(runs).toEqual(["/repo", "/repo/a"])

    setActive(true)
    expect(runs).toEqual(["/repo", "/repo/a", "/repo/c"])
  } finally {
    dispose()
  }
})
