import { expect, test } from "bun:test"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { isForegroundRunningTask } from "../../../src/routes/session"

function taskPart(opts: { background?: boolean; metadataBackground?: boolean } = {}): Part {
  return {
    id: "part-1",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: "call-1",
    tool: "task",
    state: {
      status: "running",
      input: opts.background ? { background: true } : {},
      metadata: opts.metadataBackground ? { background: true } : undefined,
      time: { start: Date.now() },
    },
  } satisfies ToolPart as Part
}

function nonTaskPart(tool: string): Part {
  return {
    id: "part-2",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: "call-2",
    tool,
    state: {
      status: "running",
      input: {},
      time: { start: Date.now() },
    },
  } satisfies ToolPart as Part
}

test("returns true for a foreground running task", () => {
  expect(isForegroundRunningTask(taskPart())).toBeTrue()
})

test("hides the background hint when input.background is already true", () => {
  expect(isForegroundRunningTask(taskPart({ background: true }))).toBeFalse()
})

test("hides the background hint when metadata.background is already true", () => {
  expect(isForegroundRunningTask(taskPart({ metadataBackground: true }))).toBeFalse()
})

test("hides the background hint when every visible child was launched in the background", () => {
  const children = [
    taskPart({ background: true }),
    taskPart({ background: true, metadataBackground: true }),
    taskPart({ metadataBackground: true }),
  ]
  expect(children.some(isForegroundRunningTask)).toBeFalse()
})

test("returns false for non-task tools", () => {
  expect(isForegroundRunningTask(nonTaskPart("read"))).toBeFalse()
  expect(isForegroundRunningTask(nonTaskPart("write"))).toBeFalse()
  expect(isForegroundRunningTask(nonTaskPart("bash"))).toBeFalse()
})

test("returns false for a completed task", () => {
  const part = {
    id: "part-3",
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool" as const,
    callID: "call-3",
    tool: "task",
    state: {
      status: "completed" as const,
      input: {},
      output: "",
      title: "",
      metadata: {},
      time: { start: Date.now(), end: Date.now() },
      content: [],
    },
  } as Part
  expect(isForegroundRunningTask(part)).toBeFalse()
})
