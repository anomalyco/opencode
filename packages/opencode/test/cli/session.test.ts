import { describe, expect, test } from "bun:test"
import { createSessionListQuery } from "../../src/cli/cmd/session"

describe("session list", () => {
  test("scopes the query to the current exact directory", () => {
    expect(createSessionListQuery({ directory: "/workspace/packages/opencode", maxCount: 12 })).toEqual({
      directory: "/workspace/packages/opencode",
      roots: true,
      limit: 12,
    })
  })
})
