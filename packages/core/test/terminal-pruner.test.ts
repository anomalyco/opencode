import { describe, expect, test } from "bun:test"
import { TerminalPruner } from "../src/util/terminal-pruner"

describe("TerminalPruner", () => {
  test("leaves output smaller than maxLines untouched", () => {
    const smallOutput = ["line 1", "line 2", "line 3"].join("\n")
    const result = TerminalPruner.prune(smallOutput, { maxLines: 10 })
    expect(result.pruned).toBe(false)
    expect(result.content).toBe(smallOutput)
    expect(result.originalLines).toBe(3)
    expect(result.prunedLines).toBe(0)
  })

  test("prunes noisy passing tests while preserving failures and stack traces", () => {
    const header = [
      "bun test v1.4.2",
      "test/math.test.ts:",
    ]
    const passingTests = Array.from({ length: 90 }, (_, i) => `✓ Math > calculates addition #${i} [0.1ms]`)
    const failureBlock = [
      "✕ Math > fails division by zero",
      "  error: DivisionByZeroError: cannot divide by zero",
      "    at divide (src/math.ts:15:9)",
      "    at test/math.test.ts:42:5",
      "  Expected: 0",
      "  Received: Infinity",
    ]
    const morePassingTests = Array.from({ length: 30 }, (_, i) => `✓ Math > calculates multiplication #${i} [0.1ms]`)
    const footer = [
      "",
      " 120 pass",
      " 1 fail",
      "Ran 121 tests. [120.00ms]",
    ]

    const fullOutput = [
      ...header,
      ...passingTests,
      ...failureBlock,
      ...morePassingTests,
      ...footer,
    ].join("\n")

    const result = TerminalPruner.prune(fullOutput, { maxLines: 50 })

    expect(result.pruned).toBe(true)
    // Preserves header
    expect(result.content).toContain("bun test v1.4.2")
    // Preserves failure block and stack trace completely
    expect(result.content).toContain("✕ Math > fails division by zero")
    expect(result.content).toContain("error: DivisionByZeroError: cannot divide by zero")
    expect(result.content).toContain("at divide (src/math.ts:15:9)")
    expect(result.content).toContain("Expected: 0")
    // Preserves footer summary
    expect(result.content).toContain("120 pass")
    expect(result.content).toContain("1 fail")
    // Pruned passing noise
    expect(result.content).toContain("pruned")
    expect(result.content).toContain("on local CPU ($0 tokens)")
    expect(result.keptLines).toBeLessThan(fullOutput.split("\n").length)
  })

  test("prunes generic large output by preserving head and tail", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `log entry line ${i + 1}`)
    const fullOutput = lines.join("\n")

    const result = TerminalPruner.prune(fullOutput, { maxLines: 40 })

    expect(result.pruned).toBe(true)
    expect(result.content).toContain("log entry line 1")
    expect(result.content).toContain("log entry line 150")
    expect(result.content).toContain("pruned 114 lines on local CPU ($0 tokens)")
    expect(result.keptLines).toBeLessThan(150)
  })

  test("handles pytest output with tracebacks cleanly", () => {
    const header = [
      "============================= test session starts ==============================",
      "platform linux -- Python 3.12.3",
      "rootdir: /home/agustin/proyectos_software/opencode",
    ]
    const passes = Array.from({ length: 80 }, (_, i) => `tests/test_unit.py::test_pass_${i} PASSED`)
    const failure = [
      "tests/test_unit.py::test_critical FAILED",
      "",
      "=================================== FAILURES ===================================",
      "_________________________________ test_critical ________________________________",
      "    def test_critical():",
      ">       assert 1 == 2",
      "E       AssertionError: assert 1 == 2",
      "",
      "tests/test_unit.py:10: AssertionError",
    ]
    const footer = [
      "=========================== short test summary info ============================",
      "FAILED tests/test_unit.py::test_critical - AssertionError: assert 1 == 2",
      "======================== 1 failed, 80 passed in 0.45s ==========================",
    ]

    const fullOutput = [...header, ...passes, ...failure, ...footer].join("\n")
    const result = TerminalPruner.prune(fullOutput, { maxLines: 40 })

    expect(result.pruned).toBe(true)
    expect(result.content).toContain("test session starts")
    expect(result.content).toContain("AssertionError: assert 1 == 2")
    expect(result.content).toContain("1 failed, 80 passed")
  })
})
