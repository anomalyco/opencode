import { expect, test } from "bun:test"
import { scheduleConnectedMeasure } from "./measure"

test("does not measure an element detached before the frame", async () => {
  const element = document.createElement("div")
  document.body.append(element)
  let calls = 0

  scheduleConnectedMeasure(element, () => {
    calls += 1
  })
  element.remove()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  expect(calls).toBe(0)
})

test("measures a connected element on the next frame", async () => {
  const element = document.createElement("div")
  document.body.append(element)
  let calls = 0

  scheduleConnectedMeasure(element, () => {
    calls += 1
  })
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  expect(calls).toBe(1)
  element.remove()
})
