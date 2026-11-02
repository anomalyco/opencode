import { describe, expect, test } from "bun:test"
import { toolCallKey, toolCallLoopDetector, toolLoopEnabled } from "../src/session/llm/tool-loop"

const feedAll = (calls: readonly unknown[]) => {
  const detector = toolCallLoopDetector()
  return calls.map((input) => detector.feed("bash", input))
}

describe("toolCallLoopDetector", () => {
  test("fires on the third identical call", () => {
    expect(feedAll([{ command: "ls" }, { command: "ls" }, { command: "ls" }])).toEqual([false, false, true])
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

  test("fires on an alternating pair after four cycles", () => {
    const a = { command: "ls" }
    const b = { command: "pwd" }
    expect(feedAll([a, b, a, b, a, b, a, b])).toEqual([false, false, false, false, false, false, false, true])
  })

  test("does not fire on three alternating pairs", () => {
    const a = { command: "ls" }
    const b = { command: "pwd" }
    expect(feedAll([a, b, a, b, a, b])).toEqual([false, false, false, false, false, false])
  })

  test("fires on a period-3 cycle after three cycles", () => {
    const cycle = [{ command: "a" }, { command: "b" }, { command: "c" }]
    const hits = feedAll([...cycle, ...cycle, ...cycle])
    expect(hits.slice(0, 8)).toEqual([false, false, false, false, false, false, false, false])
    expect(hits[8]).toBe(true)
  })

  test("fires on a period-4 cycle after three cycles", () => {
    const cycle = [{ command: "a" }, { command: "b" }, { command: "c" }, { command: "d" }]
    const hits = feedAll([...cycle, ...cycle, ...cycle])
    expect(hits.slice(0, 11).every((hit) => hit === false)).toBe(true)
    expect(hits[11]).toBe(true)
  })

  test("does not fire when a call in the cycle changes", () => {
    const a = { command: "a" }
    const b = { command: "b" }
    const c = { command: "c" }
    expect(feedAll([a, b, c, a, b, c, a, b, { command: "d" }]).every((hit) => hit === false)).toBe(true)
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
  test("includes the tool name and ignores object key order", () => {
    expect(toolCallKey("bash", { command: "ls" })).not.toBe(toolCallKey("read", { command: "ls" }))
    expect(toolCallKey("bash", { a: 1, b: 2 })).toBe(toolCallKey("bash", { b: 2, a: 1 }))
  })
})
