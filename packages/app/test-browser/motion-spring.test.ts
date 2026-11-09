import { expect, test } from "bun:test"
import { useSpring } from "@opencode/ui/motion-spring"
import { createEffect, createRoot, createSignal } from "solid-js"

// Records every value the spring emits and resolves once it reaches `settled`.
function watch(progress: () => number, settled: number) {
  const seen: number[] = []
  const { promise, resolve } = Promise.withResolvers<void>()

  createEffect(() => {
    const value = progress()

    seen.push(value)

    if (value === settled) resolve()
  })

  return { seen, settled: promise }
}

test("springs progress to its target", async () => {
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const progress = useSpring(target, { visualDuration: 0.3, bounce: 0 })

    return { dispose, progress, setTarget, ...watch(progress, 1) }
  })

  state.setTarget(1)
  await Promise.race([state.settled, Bun.sleep(2000)])

  expect(state.progress()).toBe(1)
  expect(state.seen.some((value) => value > 0 && value < 1)).toBe(true)
  expect(state.seen.every((value) => value <= 1)).toBe(true)
  state.dispose()
})

test("new spring options replace the running spring", async () => {
  const state = createRoot((dispose) => {
    const [target, setTarget] = createSignal(0)
    const [duration, setDuration] = createSignal(4)
    const progress = useSpring(target, () => ({ visualDuration: duration(), bounce: 0 }))

    return { dispose, progress, setTarget, setDuration, ...watch(progress, 1) }
  })

  state.setTarget(1)
  await Bun.sleep(100)
  expect(state.progress()).toBeLessThan(0.5)

  // The old four-second spring would still be far from its target after a second.
  state.setDuration(0.1)
  await Promise.race([state.settled, Bun.sleep(1000)])

  expect(state.progress()).toBe(1)
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
