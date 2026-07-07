import { describe, expect, test } from "bun:test"
import { ConfigWorkflowV1 } from "../../src/v1/config/workflow"

describe("ConfigWorkflowV1.roles", () => {
  test("no workflow config disables the reviewer stage", () => {
    expect(ConfigWorkflowV1.roles(undefined)).toEqual({
      planner: "plan",
      worker: "build",
      reviewer: undefined,
    })
  })

  test("empty workflow config enables defaults for every role", () => {
    expect(ConfigWorkflowV1.roles({})).toEqual({
      planner: "plan",
      worker: "build",
      reviewer: "review",
    })
  })

  test("configured roles override defaults", () => {
    expect(ConfigWorkflowV1.roles({ planner: "architect", worker: "impl", reviewer: "checker" })).toEqual({
      planner: "architect",
      worker: "impl",
      reviewer: "checker",
    })
  })

  test("partial config keeps defaults for unset roles", () => {
    expect(ConfigWorkflowV1.roles({ reviewer: "checker" })).toEqual({
      planner: "plan",
      worker: "build",
      reviewer: "checker",
    })
  })
})
