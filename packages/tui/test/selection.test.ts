import { expect, test } from "bun:test"
import { createSelectionCopy } from "../src/util/selection"

test("keeps one clipboard write active and coalesces rapid selections", async () => {
  const writes: string[] = []
  const releases: (() => void)[] = []
  let active = 0
  let maximumActive = 0
  const clipboard = {
    async read() {
      return undefined
    },
    async write(text: string) {
      writes.push(text)
      active++
      maximumActive = Math.max(maximumActive, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active--
    },
  }
  const copied: string[] = []
  const failed: unknown[] = []
  const copy = createSelectionCopy(clipboard, {
    show: (input) => copied.push(input.message),
    error: (error) => failed.push(error),
  })

  copy("first")
  for (let index = 0; index < 100; index++) copy(`selection-${index}`)

  expect(writes).toEqual(["first"])
  expect(maximumActive).toBe(1)

  releases.shift()?.()
  await Bun.sleep(0)

  expect(writes).toEqual(["first", "selection-99"])
  expect(maximumActive).toBe(1)

  releases.shift()?.()
  await Bun.sleep(0)

  expect(copied).toEqual(["Copied to clipboard"])
  expect(failed).toEqual([])
})
