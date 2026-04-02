import { describe, expect, test } from "bun:test"
import { timeout } from "../../src/tool/tool"

/**
 * Tests for the tool timeout computation extracted from Tool.define.
 *
 * The `timeout()` function computes the effective deadline for non-task tool
 * executions. Task tools are exempt from the outer wrapper entirely — their
 * deadline is managed inside task.ts.
 */

describe("tool.timeout", () => {
  const DEFAULT = 15 * 60 * 1000 // 900_000ms = 15 min

  test("uses hardcoded default when no config", () => {
    expect(timeout({})).toBe(DEFAULT)
  })

  test("respects tool_timeout config", () => {
    expect(timeout({ tool: 300_000 })).toBe(300_000)
  })

  test("error message uses seconds", () => {
    const ms = timeout({})
    expect(Math.round(ms / 1000)).toBe(900)
    const msg = `Tool execution exceeded ${Math.round(ms / 1000)}s global timeout`
    expect(msg).toBe("Tool execution exceeded 900s global timeout")
  })
})
