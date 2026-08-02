import { describe, expect, test } from "bun:test"
import { createMoveSessionSelectionHandler } from "../../src/component/prompt/move"

const selection = { type: "directory", directory: "/project", subdirectory: false } as const

describe("prompt move selection", () => {
  test("updates the destination after the directory is validated", async () => {
    const validated: string[] = []
    let destination = "/current"
    const select = createMoveSessionSelectionHandler({
      validate: async (directory) => {
        validated.push(directory)
      },
      onSelect: (value) => {
        if (value.type === "directory") destination = value.directory
      },
      onError() {},
    })

    await select(selection)

    expect(validated).toEqual(["/project"])
    expect(destination).toBe("/project")
  })

  test("keeps the destination unchanged when validation fails", async () => {
    const failure = new Error("Directory not found")
    const errors: unknown[] = []
    let destination = "/current"
    const select = createMoveSessionSelectionHandler({
      validate: async () => {
        throw failure
      },
      onSelect: (value) => {
        if (value.type === "directory") destination = value.directory
      },
      onError: (error) => errors.push(error),
    })

    await select(selection)

    expect(destination).toBe("/current")
    expect(errors).toEqual([failure])
  })

  test("reports synchronous validation failures and allows retrying", async () => {
    const failure = new Error("Directory not found")
    const errors: unknown[] = []
    let validations = 0
    let selections = 0
    const select = createMoveSessionSelectionHandler({
      validate: () => {
        validations += 1
        if (validations === 1) throw failure
        return Promise.resolve()
      },
      onSelect: () => {
        selections += 1
      },
      onError: (error) => errors.push(error),
    })

    await select(selection)
    await select(selection)

    expect(validations).toBe(2)
    expect(selections).toBe(1)
    expect(errors).toEqual([failure])
  })

  test("selects a new destination without directory validation", async () => {
    let validations = 0
    let selected: string | undefined
    const select = createMoveSessionSelectionHandler({
      validate: async () => {
        validations += 1
      },
      onSelect: (value) => {
        selected = value.type
      },
      onError() {},
    })

    await select({ type: "new" })

    expect(validations).toBe(0)
    expect(selected).toBe("new")
  })

  test("ignores duplicate selections while validation is pending", async () => {
    let resolve!: () => void
    let validations = 0
    let selections = 0
    const select = createMoveSessionSelectionHandler({
      validate: () => {
        validations += 1
        return new Promise<void>((done) => (resolve = done))
      },
      onSelect: () => {
        selections += 1
      },
      onError() {},
    })

    const first = select(selection)
    const second = select(selection)

    expect(validations).toBe(1)
    expect(selections).toBe(0)
    resolve()
    await Promise.all([first, second])
    expect(selections).toBe(1)
  })

  test("ignores duplicate selections while onSelect is pending", async () => {
    let resolve!: () => void
    let validations = 0
    let selections = 0
    const select = createMoveSessionSelectionHandler({
      validate: async () => {
        validations += 1
      },
      onSelect: () => {
        selections += 1
        return new Promise<void>((done) => (resolve = done))
      },
      onError() {},
    })

    const first = select(selection)
    await Promise.resolve()
    const second = select(selection)

    expect(validations).toBe(1)
    expect(selections).toBe(1)
    resolve()
    await Promise.all([first, second])
    expect(selections).toBe(1)
  })
})
