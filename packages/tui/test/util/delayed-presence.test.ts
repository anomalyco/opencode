import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createDelayedPresence } from "../../src/util/delayed-presence"

test("shows only after the same value remains present for the delay", async () => {
  await createRoot(async (dispose) => {
    const [value, setValue] = createSignal<string>()
    const visible = createDelayedPresence(value, 40)

    setValue("first")
    await Bun.sleep(20)
    expect(visible()).toBe(false)

    setValue("second")
    await Bun.sleep(25)
    expect(visible()).toBe(false)
    await Bun.sleep(25)
    expect(visible()).toBe(true)

    dispose()
  })
})

test("cancels the delay when the value disappears or the owner is disposed", async () => {
  await createRoot(async (dispose) => {
    const [value, setValue] = createSignal<string>()
    const visible = createDelayedPresence(value, 30)

    setValue("running")
    setValue(undefined)
    await Bun.sleep(40)
    expect(visible()).toBe(false)

    setValue("running")
    dispose()
    await Bun.sleep(40)
    expect(visible()).toBe(false)
  })
})
