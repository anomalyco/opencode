// Unit tests for missedCompletedParts() (src/cli/cmd/run.ts): the helper
// behind the idle flush in non-interactive `run`. The live event stream can
// publish session.status idle before the final message.part.updated (or drop
// it on some transports); without the flush, short answers vanish and the
// command exits 0 with empty output.
import { describe, expect, test } from "bun:test"
import { missedCompletedParts } from "../../../src/cli/cmd/run"
import type { Message, Part } from "@opencode-ai/sdk/v2"

function textPart(id: string, text: string, ended: boolean): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text,
    ...(ended ? { time: { start: 1, end: 2 } } : { time: { start: 1 } }),
  }
}

function reasoningPart(id: string, ended: boolean): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "thinking out loud",
    time: ended ? { start: 1, end: 2 } : { start: 1 },
  }
}

function toolPart(id: string, status: "completed" | "error" | "pending"): Part {
  const base = {
    id,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool" as const,
    callID: "call_1",
    tool: "bash",
  }
  if (status === "completed") {
    return {
      ...base,
      state: { status, input: {}, output: "ok", title: "ls", metadata: {}, time: { start: 1, end: 2 } },
    }
  }
  if (status === "error") {
    return { ...base, state: { status, input: {}, error: "boom", time: { start: 1, end: 2 } } }
  }
  return { ...base, state: { status, input: {}, raw: "{}" } }
}

function assistantMessages(parts: Array<Part>): Array<{ info: Message; parts: Array<Part> }> {
  return [
    {
      info: {
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1 },
        parentID: "msg_0",
        modelID: "m",
        providerID: "p",
        mode: "build",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts,
    },
  ]
}

describe("missedCompletedParts", () => {
  test("returns finished text parts the stream never delivered", () => {
    const missed = missedCompletedParts(assistantMessages([textPart("p1", "OK", true)]), new Set(), true)
    expect(missed.map((p) => p.id)).toEqual(["p1"])
  })

  test("skips parts already emitted over the live stream", () => {
    const missed = missedCompletedParts(
      assistantMessages([textPart("p1", "OK", true), textPart("p2", "hi", true)]),
      new Set(["p1"]),
      true,
    )
    expect(missed.map((p) => p.id)).toEqual(["p2"])
  })

  test("skips unfinished parts (no end timestamp yet)", () => {
    const missed = missedCompletedParts(assistantMessages([textPart("p1", "par", false)]), new Set(), true)
    expect(missed).toEqual([])
  })

  test("skips reasoning parts when thinking is off", () => {
    const missed = missedCompletedParts(assistantMessages([reasoningPart("p1", true)]), new Set(), false)
    expect(missed).toEqual([])
  })

  test("returns finished reasoning parts when thinking is on", () => {
    const missed = missedCompletedParts(assistantMessages([reasoningPart("p1", true)]), new Set(), true)
    expect(missed.map((p) => p.id)).toEqual(["p1"])
  })

  test("returns completed and errored tool parts, not pending ones", () => {
    const missed = missedCompletedParts(
      assistantMessages([toolPart("t1", "completed"), toolPart("t2", "error"), toolPart("t3", "pending")]),
      new Set(),
      true,
    )
    expect(missed.map((p) => p.id)).toEqual(["t1", "t2"])
  })

  test("ignores user messages", () => {
    const messages = [
      {
        info: {
          id: "msg_0",
          sessionID: "ses_1",
          role: "user" as const,
          time: { created: 0 },
          agent: "build",
          model: { providerID: "p", modelID: "m" },
        },
        parts: [textPart("p0", "hello", true)],
      },
      ...assistantMessages([]),
    ]
    expect(missedCompletedParts(messages, new Set(), true)).toEqual([])
  })

  test("skips synthetic continuation signals", () => {
    const part = { ...textPart("p1", "", true), synthetic: true }
    const missed = missedCompletedParts(assistantMessages([part]), new Set(), true)
    expect(missed).toEqual([])
  })

  test("empty timeline yields nothing", () => {
    expect(missedCompletedParts([], new Set(), true)).toEqual([])
  })
})
