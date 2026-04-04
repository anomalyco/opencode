/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { onMount } from "solid-js"

type Slots = {
  prompt: {}
}

test("replace slot mounts plugin content once", async () => {
  let mounts = 0

  const Probe = () => {
    onMount(() => {
      mounts += 1
    })

    return <box />
  }

  const App = () => {
    const renderer = useRenderer()
    const reg = createSolidSlotRegistry<Slots>(renderer, {})
    const Slot = createSlot(reg)

    reg.register({
      id: "plugin",
      slots: {
        prompt() {
          return <Probe />
        },
      },
    })

    return (
      <box>
        <Slot name="prompt" mode="replace">
          <box />
        </Slot>
      </box>
    )
  }

  await testRender(() => <App />)

  expect(mounts).toBe(1)
})
