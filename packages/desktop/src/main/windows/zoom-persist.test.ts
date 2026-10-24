import { expect, test } from "bun:test"
import { createZoomPersister } from "./zoom-persist"

const settled = () => new Promise((resolve) => setTimeout(resolve, 400))

test("writes the first change immediately", () => {
  const writes: number[] = []
  createZoomPersister((value) => writes.push(value)).push(1.2)

  expect(writes).toEqual([1.2])
})

test("coalesces rapid changes into one trailing write", async () => {
  const writes: number[] = []
  const persister = createZoomPersister((value) => writes.push(value))
  persister.push(1.2)
  persister.push(1.4)
  persister.push(1.6)

  expect(writes).toEqual([1.2])

  await settled()
  expect(writes).toEqual([1.2, 1.6])
})

test("flush writes the pending value", () => {
  const writes: number[] = []
  const persister = createZoomPersister((value) => writes.push(value))
  persister.push(1.2)
  persister.push(1.4)
  persister.flush()

  expect(writes).toEqual([1.2, 1.4])
})

test("does not write an unchanged value", async () => {
  const writes: number[] = []
  const persister = createZoomPersister((value) => writes.push(value))
  persister.push(1.2)
  persister.push(1.2)

  await settled()
  persister.flush()
  expect(writes).toEqual([1.2])
})
