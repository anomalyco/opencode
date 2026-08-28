import { expect, test } from "bun:test"
import { moveSessionLocation } from "./location-recovery"

test("moves an unavailable session to the selected directory", async () => {
  const moving: boolean[] = []
  const moved: string[] = []

  const result = await moveSessionLocation({
    selection: ["/repo/recovered"],
    moving: false,
    setMoving: (value) => moving.push(value),
    move: async (directory) => moved.push(directory),
    failed: () => undefined,
  })

  expect(result).toBe(true)
  expect(moved).toEqual(["/repo/recovered"])
  expect(moving).toEqual([true, false])
})

test("keeps the recovery action available after a failed move", async () => {
  const moving: boolean[] = []
  const errors: unknown[] = []
  const error = new Error("unavailable")

  const result = await moveSessionLocation({
    selection: "/repo/missing",
    moving: false,
    setMoving: (value) => moving.push(value),
    move: async () => {
      throw error
    },
    failed: (cause) => errors.push(cause),
  })

  expect(result).toBe(false)
  expect(errors).toEqual([error])
  expect(moving).toEqual([true, false])
})

test("ignores cancelled and duplicate recovery attempts", async () => {
  let moves = 0
  const input = {
    setMoving: () => undefined,
    move: async () => {
      moves++
    },
    failed: () => undefined,
  }

  expect(await moveSessionLocation({ ...input, selection: null, moving: false })).toBe(false)
  expect(await moveSessionLocation({ ...input, selection: "/repo/next", moving: true })).toBe(false)
  expect(moves).toBe(0)
})
