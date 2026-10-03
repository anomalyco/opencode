/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createSlot, createSolidSlotRegistry, testRender, useRenderer } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"
import { createSlots, type HostPluginApi } from "../../src/plugin/slots"

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
    const registry = createSolidSlotRegistry<Slots>(useRenderer(), {})
    const Slot = createSlot(registry)
    registry.register({ id: "plugin", slots: { prompt: () => <Probe /> } })

    return (
      <Slot name="prompt" mode="replace">
        <box />
      </Slot>
    )
  }

  const app = await testRender(() => <App />)
  try {
    expect(mounts).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("plugin slot render errors stay isolated from the host", async () => {
  const App = () => {
    const slots = createSlots()
    const renderer = useRenderer()
    const [ready, setReady] = createSignal(false)

    onMount(() => {
      const host = slots.setup({
        renderer,
        theme: { current: {} },
      } as HostPluginApi)
      host.register({
        id: "crash",
        slots: {
          sidebar_content() {
            const s = () => ({}) as { tailHygiene: { evaluable: boolean } }
            return <text>{String(s().tailHygiene.evaluable)}</text>
          },
        },
      })
      setReady(true)
    })

    return (
      <box>
        {ready() && <slots.Slot name="sidebar_content" session_id="ses_test" />}
        <text>host-ok</text>
      </box>
    )
  }

  const app = await testRender(() => <App />, { width: 40, height: 4 })
  try {
    await app.renderOnce()
    await Bun.sleep(25)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("host-ok")
  } finally {
    app.renderer.destroy()
  }
})
