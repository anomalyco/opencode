import { expect, test } from "bun:test"
import { coalesceProgressCommit, resolveRunAgent } from "../../src/mini/footer"
import type { RunAgent, StreamCommit } from "../../src/mini/types"

function progress(input: Partial<StreamCommit> = {}): StreamCommit {
  return {
    kind: "tool",
    source: "tool",
    phase: "progress",
    text: "one",
    messageID: "msg_1",
    partID: "part_1",
    tool: "shell",
    toolState: "running",
    ...input,
  }
}

test("coalesces progress only within the same message and tool state", () => {
  expect(coalesceProgressCommit(progress(), progress({ messageID: "msg_2" }))).toBeUndefined()
  expect(coalesceProgressCommit(progress(), progress({ toolState: "completed" }))).toBeUndefined()
  expect(coalesceProgressCommit(progress(), progress({ text: "two", directory: "/latest" }))).toEqual(
    progress({ text: "onetwo", directory: "/latest" }),
  )
})

test("falls back only when no agent is selected", () => {
  const agents: RunAgent[] = [
    { id: "task", name: "Task", mode: "subagent", hidden: false },
    { id: "secret", name: "Secret", mode: "primary", hidden: true },
    { id: "build", name: "Build", mode: "primary", hidden: false },
    { id: "plan", name: "Plan", mode: "primary", hidden: false },
  ]

  expect(resolveRunAgent(agents, undefined)?.id).toBe("build")
  expect(resolveRunAgent(agents, "plan")?.id).toBe("plan")
  expect(resolveRunAgent(agents, "missing")).toBeUndefined()
})
