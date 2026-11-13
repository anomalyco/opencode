import { expect, test } from "bun:test"
import { createViewportWriter } from "./viewport-native"

const phone = { mode: "fixed", width: 390, height: 844 } as const

test("switching from Fit to the same percentage locks the scale until Fit is selected again", async () => {
  const initial = { width: 195, height: 422 }

  const small = { width: 100, height: 211 }

  const half = { ...phone, scale: 0.5 } as const

  const writer = createViewportWriter(
    async () => {},
    () => {},
    () => false,
  )

  await writer.set(phone, initial, 1)
  await writer.set(half, initial, 1)
  expect(writer.applied().viewport).toEqual(half)
  await writer.set(half, small, 1)
  expect(writer.applied().scale).toBe(0.5)
  await writer.set({ ...phone, scale: 2 }, small, 1)
  expect(writer.applied().scale).toBe(2)
  await writer.set(phone, small, 1)
  expect(writer.applied()).toEqual({ viewport: phone, scale: 0.25 })
})

test("Auto wins when the pane resizes during an outstanding fixed-size command", async () => {
  const started = Promise.withResolvers<void>()

  const finish = Promise.withResolvers<void>()

  const commands: string[] = []

  const writer = createViewportWriter(
    async (next) => {
      commands.push(`${next.viewport.mode}:${next.scale}`)
      started.resolve()
      await finish.promise
    },
    () => {},
    () => false,
  )

  const first = writer.set(phone, phone, 1)
  await started.promise
  const resize = writer.set(phone, { width: 195, height: 422 }, 1)

  const reset = writer.set({ mode: "auto" }, phone, 1)
  finish.resolve()
  await Promise.all([first, resize, reset])
  expect(commands).toEqual(["fixed:1", "auto:1"])
  expect(writer.applied().viewport).toEqual({ mode: "auto" })
})
