import { describe, expect, it } from "bun:test"
import { Tool } from "@opencode-ai/core/public"
import { Effect } from "effect"

describe("public Tool API", () => {
  it("keeps the public registration capability narrow", () => {
    const tools = {
      register: () => Effect.void,
    } satisfies Tool.Interface

    expect(Object.keys(tools)).toEqual(["register"])
  })
})
