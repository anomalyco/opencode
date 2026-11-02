import { describe, expect, test } from "bun:test"
import {
  TOOL_LOOP_CYCLE_COPIES,
  TOOL_LOOP_MAX_PERIOD,
  TOOL_LOOP_THRESHOLD,
  toolCallKey,
  toolCallLoopDetector,
  toolLoopEnabled,
} from "../src/session/llm/tool-loop"

describe("toolCallLoopDetector", () => {
  test("fires on the third identical call", () => {
    const detector = toolCallLoopDetector()
    expect(detector.feed("bash", { command: "ls" })).toBe(false)
    expect(detector.feed("bash", { command: "ls" })).toBe(false)
    expect(detector.feed("bash", { command: "ls" })).toBe(true)
  })

  test("does not fire on two identical calls", () => {
    const detector = toolCallLoopDetector()
    detector.feed("bash", { command: "ls" })
    expect(detector.feed("bash", { command: "ls" })).toBe(false)
  })

  test("does not fire when the tool or input changes", () => {
    const detector = toolCallLoopDetector()
    detector.feed("bash", { command: "ls" })
    detector.feed("bash", { command: "pwd" })
    expect(detector.feed("bash", { command: "ls" })).toBe(false)
    detector.feed("read", { filePath: "/tmp/x" })
    expect(detector.feed("read", { filePath: "/tmp/x" })).toBe(false)
    expect(detector.feed("read", { filePath: "/tmp/x" })).toBe(true)
  })

  test("object key order does not matter", () => {
    const detector = toolCallLoopDetector()
    detector.feed("bash", { command: "ls", description: "list" })
    detector.feed("bash", { description: "list", command: "ls" })
    expect(detector.feed("bash", { command: "ls", description: "list" })).toBe(true)
  })

  test("reset clears the history", () => {
    const detector = toolCallLoopDetector()
    detector.feed("bash", { command: "ls" })
    detector.feed("bash", { command: "ls" })
    detector.reset()
    expect(detector.feed("bash", { command: "ls" })).toBe(false)
  })

  test("fires again on the fourth identical call", () => {
    const detector = toolCallLoopDetector()
    detector.feed("bash", { command: "ls" })
    detector.feed("bash", { command: "ls" })
    expect(detector.feed("bash", { command: "ls" })).toBe(true)
    expect(detector.feed("bash", { command: "ls" })).toBe(true)
  })

  test("threshold is three", () => {
    expect(TOOL_LOOP_THRESHOLD).toBe(3)
  })

  test("fires on an alternating pair after four cycles", () => {
    const detector = toolCallLoopDetector()
    const a = { command: "ls v2/STATUS*.md" }
    const b = { command: "sed -n '1,60p' v2/installer/DESIGN-installer-2026-10-29.md" }
    const calls = [a, b, a, b, a, b, a, b]
    const hits = calls.map((input) => detector.feed("bash", input))
    expect(hits.slice(0, 7)).toEqual([false, false, false, false, false, false, false])
    expect(hits[7]).toBe(true)
  })

  test("does not fire on three alternating pairs", () => {
    const detector = toolCallLoopDetector()
    const a = { command: "ls" }
    const b = { command: "pwd" }
    for (const input of [a, b, a, b, a, b]) expect(detector.feed("bash", input)).toBe(false)
  })

  test("fires on a period-3 cycle after three cycles", () => {
    const detector = toolCallLoopDetector()
    const calls = [
      { command: "a" },
      { command: "b" },
      { command: "c" },
      { command: "a" },
      { command: "b" },
      { command: "c" },
      { command: "a" },
      { command: "b" },
      { command: "c" },
    ]
    const hits = calls.map((input) => detector.feed("bash", input))
    expect(hits.slice(0, 8).every((hit) => hit === false)).toBe(true)
    expect(hits[8]).toBe(true)
  })

  test("fires on a period-4 cycle after three cycles", () => {
    const detector = toolCallLoopDetector()
    const calls = [
      { command: "a" },
      { command: "b" },
      { command: "c" },
      { command: "d" },
      { command: "a" },
      { command: "b" },
      { command: "c" },
      { command: "d" },
      { command: "a" },
      { command: "b" },
      { command: "c" },
      { command: "d" },
    ]
    const hits = calls.map((input) => detector.feed("bash", input))
    expect(hits.slice(0, 11).every((hit) => hit === false)).toBe(true)
    expect(hits[11]).toBe(true)
  })

  test("a period-3 cycle with a changed call does not fire", () => {
    const detector = toolCallLoopDetector()
    const a = { command: "a" }
    const b = { command: "b" }
    const c = { command: "c" }
    const d = { command: "d" }
    for (const input of [a, b, c, a, b, c, a, b, d]) expect(detector.feed("bash", input)).toBe(false)
  })

  test("a period-2 cycle with a changed call does not fire", () => {
    const detector = toolCallLoopDetector()
    const a = { command: "ls" }
    const b = { command: "pwd" }
    const c = { command: "date" }
    for (const input of [a, b, a, b, a, b, a, c]) expect(detector.feed("bash", input)).toBe(false)
  })

  test("constants are the documented values", () => {
    expect(TOOL_LOOP_MAX_PERIOD).toBe(4)
    expect(TOOL_LOOP_CYCLE_COPIES).toBe(4)
  })

  test("kill switch: OPENCODE_TOOL_LOOP_DETECT=0 turns the rule off, default is on", () => {
    expect(toolLoopEnabled({})).toBe(true)
    expect(toolLoopEnabled({ OPENCODE_TOOL_LOOP_DETECT: "1" })).toBe(true)
    expect(toolLoopEnabled({ OPENCODE_TOOL_LOOP_DETECT: "0" })).toBe(false)
    expect(toolLoopEnabled({ OPENCODE_TOOL_LOOP_DETECT: "false" })).toBe(false)
    expect(toolLoopEnabled({ OPENCODE_TOOL_LOOP_DETECT: "off" })).toBe(false)
    expect(toolLoopEnabled({ OPENCODE_TOOL_LOOP_DETECT: "no" })).toBe(false)
  })
})

describe("toolCallKey", () => {
  test("includes the tool name", () => {
    expect(toolCallKey("bash", { command: "ls" })).not.toBe(toolCallKey("read", { command: "ls" }))
  })

  test("is stable across object key order", () => {
    expect(toolCallKey("bash", { a: 1, b: 2 })).toBe(toolCallKey("bash", { b: 2, a: 1 }))
  })
})

describe("cross-step tool-call loop regression sequences", () => {
  const run = (calls: readonly { tool: string; input: unknown }[]) => {
    const detector = toolCallLoopDetector()
    let first: number | undefined
    let streak = 0
    let maxRun = 0
    let prev: string | undefined
    calls.forEach((call, at) => {
      const key = toolCallKey(call.tool, call.input)
      if (key === prev) streak++
      else {
        streak = 1
        prev = key
      }
      maxRun = Math.max(maxRun, streak)
      if (detector.feed(call.tool, call.input) && first === undefined) first = at
    })
    return { first, maxRun }
  }

  test("a 110-call run of one identical call fires on the third copy", () => {
    const repeated = { tool: "grep", input: { pattern: "FIXME" } }
    const calls = [
      { tool: "read", input: { filePath: "/project/a.ts" } },
      { tool: "bash", input: { command: "ls" } },
      { tool: "grep", input: { pattern: "TODO" } },
      ...Array.from({ length: 110 }, () => repeated),
      { tool: "read", input: { filePath: "/project/b.ts" } },
      { tool: "bash", input: { command: "pwd" } },
      { tool: "write", input: { filePath: "/project/c.ts", content: "x" } },
    ]
    expect(run(calls)).toEqual({ first: 5, maxRun: 110 })
  })

  test("a 495-call run of one identical call fires on the third copy", () => {
    const repeated = { tool: "bash", input: { command: "ls" } }
    const calls = [
      { tool: "read", input: { filePath: "/project/a.ts" } },
      { tool: "bash", input: { command: "pwd" } },
      ...Array.from({ length: 495 }, () => repeated),
    ]
    expect(run(calls)).toEqual({ first: 4, maxRun: 495 })
  })

  test("an alternating pair fires at the eighth call", () => {
    const calls = Array.from({ length: 352 }, (_, at) =>
      at % 2 === 0
        ? { tool: "bash", input: { command: "ls" } }
        : { tool: "read", input: { filePath: "/project/a.ts" } },
    )
    expect(run(calls)).toEqual({ first: 7, maxRun: 1 })
  })
})
