import { expect, test } from "bun:test"
import { useSpring } from "@opencode/ui/motion-spring"
import { createRoot, createSignal } from "solid-js"

test("springs progress to its target", async () => {
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const progress = useSpring(target, { visualDuration: 0.1, bounce: 0 })

    return { dispose, progress, setTarget }
  })

  const seen: number[] = []

  state.setTarget(1)

  const deadline = Date.now() + 1000

  while (state.progress() !== 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 16))
    seen.push(state.progress())
  }

  expect(state.progress()).toBe(1)
  expect(seen.some((value) => value > 0 && value < 1)).toBe(true)
  expect(seen.every((value) => value <= 1)).toBe(true)
  state.dispose()
})

test("snaps spring progress when the session changes", async () => {
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const [session, setSession] = createSignal("session-a")
    const progress = useSpring(target, { visualDuration: 0.3, bounce: 0 }, session)

    return { dispose, progress, setTarget, setSession }
  })

  await new Promise<void>(queueMicrotask)
  state.setTarget(1)
  expect(state.progress()).toBe(0)

  state.setSession("session-b")
  expect(state.progress()).toBe(1)
  state.dispose()
})
