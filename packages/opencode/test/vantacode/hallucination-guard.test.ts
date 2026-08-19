import { describe, expect, test } from "bun:test"
import { ExecutionLog, HallucinationStreak, detectHallucination } from "@/vantacode/hallucination-guard"

describe("ExecutionLog", () => {
  test("records and queries executed tools", () => {
    const log = new ExecutionLog()
    expect(log.count).toBe(0)
    log.record({ tool: "edit", args: { file_path: "a.ts" }, ok: true })
    expect(log.count).toBe(1)
    expect(log.ran((t) => t === "edit")).toBe(true)
    expect(log.ran((t) => t === "bash")).toBe(false)
    log.reset()
    expect(log.count).toBe(0)
  })
})

describe("detectHallucination", () => {
  test("flags an edit claim with no matching tool run", () => {
    const log = new ExecutionLog()
    const verdict = detectHallucination("I've edited the file to add the function.", log, false)
    expect(verdict.hallucinated).toBe(true)
    expect(verdict.category).toBe("edit")
  })

  test("does not flag when a matching edit tool actually ran", () => {
    const log = new ExecutionLog()
    log.record({ tool: "edit", args: {}, ok: true })
    const verdict = detectHallucination("I've edited the file to add the function.", log, true)
    expect(verdict.hallucinated).toBe(false)
  })

  test("flags an edit claim even if an unrelated tool ran", () => {
    const log = new ExecutionLog()
    log.record({ tool: "read", args: {}, ok: true })
    const verdict = detectHallucination("I've edited the file.", log, true)
    expect(verdict.hallucinated).toBe(true)
  })

  test("does not flag hypothetical / future statements", () => {
    const log = new ExecutionLog()
    expect(detectHallucination("I will edit the file next.", log, false).hallucinated).toBe(false)
    expect(detectHallucination("I could run the tests.", log, false).hallucinated).toBe(false)
  })

  test("flags a shell-run claim with no matching tool run", () => {
    const log = new ExecutionLog()
    const verdict = detectHallucination("I ran the command and the output returned success.", log, false)
    expect(verdict.hallucinated).toBe(true)
    expect(verdict.category).toBe("shell")
  })

  test("empty text is never a hallucination", () => {
    expect(detectHallucination("", new ExecutionLog(), false).hallucinated).toBe(false)
  })
})

describe("HallucinationStreak", () => {
  test("counts consecutive hallucinations and warns at threshold", () => {
    const streak = new HallucinationStreak()
    streak.record(true)
    streak.record(true)
    expect(streak.shouldWarn()).toBe(false)
    streak.record(true)
    expect(streak.current).toBe(3)
    expect(streak.shouldWarn()).toBe(true)
    expect(streak.totalCount).toBe(3)
  })

  test("a clean turn resets the streak but not the total", () => {
    const streak = new HallucinationStreak()
    streak.record(true)
    streak.record(false)
    expect(streak.current).toBe(0)
    expect(streak.totalCount).toBe(1)
  })
})
