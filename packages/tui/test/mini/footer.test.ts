import { expect, test } from "bun:test"
import { coalesceProgressCommit } from "../../src/mini/footer"
import type { StreamCommit } from "../../src/mini/types"

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
