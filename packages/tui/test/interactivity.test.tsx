/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { InteractivityProvider, useInteractivity } from "../src/context/interactivity"

test("interactivity is independent of the keymap and cannot re-enable a disabled ancestor", async () => {
  const [parent, setParent] = createSignal(true)
  const [child, setChild] = createSignal(true)
  let defaults!: () => boolean
  let enabled!: () => boolean

  function Probe() {
    enabled = useInteractivity()
    return null
  }

  function Harness() {
    defaults = useInteractivity()
    return (
      <InteractivityProvider enabled={parent()}>
        <InteractivityProvider enabled={child()}>
          <Probe />
        </InteractivityProvider>
      </InteractivityProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    expect(defaults()).toBe(true)
    expect(enabled()).toBe(true)
    setParent(false)
    expect(enabled()).toBe(false)
    setChild(false)
    setChild(true)
    expect(enabled()).toBe(false)
    setParent(true)
    expect(enabled()).toBe(true)
    setChild(false)
    expect(enabled()).toBe(false)
    expect(defaults()).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
