import { expect, test } from "bun:test"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { createRoot, createSignal } from "solid-js"

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
