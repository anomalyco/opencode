import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Worktree } from "../src/worktree.js"

describe("Worktree.CreateInput", () => {
  test("allows the server to choose the destination", () => {
    const input = Schema.decodeUnknownSync(Worktree.CreateInput)({
      projectID: "project",
      strategy: "git",
    })
    expect(input.directory).toBeUndefined()
    expect(Schema.encodeSync(Worktree.CreateInput)({ ...input, directory: undefined })).toEqual({
      projectID: "project",
      strategy: "git",
    })
  })

  test("preserves an explicit destination", () => {
    const input = { projectID: "project", strategy: "git", directory: "/custom/worktrees" }
    expect(Schema.encodeSync(Worktree.CreateInput)(Schema.decodeUnknownSync(Worktree.CreateInput)(input))).toEqual(
      input,
    )
  })
})

test("worktree creation can omit strategy and destination", () => {
  const value = Schema.decodeUnknownSync(Worktree.CreateInput)({ projectID: "project", name: "task" })
  expect(Schema.encodeSync(Worktree.CreateInput)(value)).toEqual({ projectID: "project", name: "task" })
})

test("existing inventory rows do not require configuration provenance", () => {
  const value = Schema.decodeUnknownSync(Worktree.Directory)({ directory: "/repo/task", strategy: "git" })
  expect(Schema.encodeSync(Worktree.Directory)(value)).toEqual({ directory: "/repo/task", strategy: "git" })
})

test("strategy failures can request force confirmation without Core or Git dependencies", () => {
  const value = new Worktree.OperationError({ message: "Dirty worktree", forceRequired: true })
  expect(value.forceRequired).toBe(true)
  expect(
    Schema.encodeSync(Worktree.OperationError)(new Worktree.OperationError({ message: "Failed" })),
  ).not.toHaveProperty("forceRequired")
})
