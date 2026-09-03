import { describe, expect, test } from "bun:test"
import { resolvePromptMoveDirectory } from "../../src/component/prompt/move"

describe("prompt move directory resolution", () => {
  test("rejects unavailable existing directories before selecting them", async () => {
    const errors: unknown[] = []
    const resolved = await resolvePromptMoveDirectory({
      selection: { type: "directory", directory: "/missing/project", subdirectory: false },
      create: async () => {
        throw new Error("should not create")
      },
      validate: async () => {
        throw new Error("directory missing")
      },
      onUnavailable: (error) => errors.push(error),
    })

    expect(resolved).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    if (errors[0] instanceof Error) expect(errors[0].message).toBe("directory missing")
  })

  test("returns available existing directories", async () => {
    const resolved = await resolvePromptMoveDirectory({
      selection: { type: "directory", directory: "/workspace/project", subdirectory: false },
      create: async () => undefined,
      validate: async (directory) => {
        expect(directory).toBe("/workspace/project")
      },
      onUnavailable: () => {
        throw new Error("should not report available directory")
      },
    })

    expect(resolved).toBe("/workspace/project")
  })

  test("keeps generated project copy destinations", async () => {
    const resolved = await resolvePromptMoveDirectory({
      selection: { type: "new" },
      create: async () => "/workspace/copy",
      validate: async (directory) => {
        expect(directory).toBe("/workspace/copy")
      },
      onUnavailable: () => {
        throw new Error("should not report generated directory")
      },
    })

    expect(resolved).toBe("/workspace/copy")
  })
})
