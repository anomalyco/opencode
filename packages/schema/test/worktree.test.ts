import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Worktree } from "../src/worktree.js"

describe("Worktree.CreateInput", () => {
  test("allows the server to choose the destination", () => {
    const input = Schema.decodeUnknownSync(Worktree.CreateInput)({
      strategy: "git",
    })
    expect(input.directory).toBeUndefined()
    expect(Schema.encodeSync(Worktree.CreateInput)({ ...input, directory: undefined })).toEqual({
      strategy: "git",
    })
  })

  test("preserves an explicit destination", () => {
    const input = { strategy: "git", directory: "/custom/worktrees" }
    expect(Schema.encodeSync(Worktree.CreateInput)(Schema.decodeUnknownSync(Worktree.CreateInput)(input))).toEqual(
      input,
    )
  })
})

test("worktree mutation inputs do not require a project or explicit creation defaults", () => {
  const value = Schema.decodeUnknownSync(Worktree.CreateInput)({ name: "task" })
  expect(Schema.encodeSync(Worktree.CreateInput)(value)).toEqual({ name: "task" })
  expect(Schema.encodeSync(Worktree.CreateInput)(Schema.decodeUnknownSync(Worktree.CreateInput)({}))).toEqual({})
  expect(Worktree.CreateInput.fields).not.toHaveProperty("projectID")
  expect(Worktree.RemoveInput.fields).not.toHaveProperty("projectID")
})

test("inventory contains only the directory and its owning strategy", () => {
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
