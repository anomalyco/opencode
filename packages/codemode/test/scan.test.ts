import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { CodeMode } from "../src/index.js"

describe("CodeMode.scanTools", () => {
  test("extracts dotted, bracketed and nested static tool calls in first-seen order", () => {
    const scanned = CodeMode.scanTools(`
      const chapters = await tools["hex-meetings"].get_chapters({ meeting_id: "m1" })
      const thread = await tools.slack.read_thread({ ts: await tools.slack.latest_ts({}) })
      await tools.slack.read_thread({ ts: "again" })
      const ignored = { tools: 1 }.tools
      return { wake: true, state: chapters }
    `)
    expect(Result.isSuccess(scanned)).toBe(true)
    if (Result.isSuccess(scanned)) {
      expect(scanned.success).toEqual(["hex-meetings.get_chapters", "slack.read_thread", "slack.latest_ts"])
    }
  })

  test("ignores shadowed local tools bindings", () => {
    const scanned = CodeMode.scanTools(`
      function helper(tools) {
        return tools[dynamicKey]()
      }
      {
        const tools = { any: () => 1 }
        tools.any()
      }
      return helper({ [dynamicKey]: () => ({ wake: false }) })
    `)
    expect(scanned).toEqual(Result.succeed([]))
  })

  test("rejects empty code, syntax errors, dynamic bracket access, and aliasing tools", () => {
    expect(Result.isFailure(CodeMode.scanTools("   "))).toBe(true)
    expect(Result.isFailure(CodeMode.scanTools("const x = {"))).toBe(true)
    expect(Result.isFailure(CodeMode.scanTools("return await tools.slack[name]({})"))).toBe(true)
    expect(Result.isFailure(CodeMode.scanTools("const s = tools.slack; return await s.read_thread({})"))).toBe(true)
    expect(Result.isFailure(CodeMode.scanTools("return Object.keys(tools)"))).toBe(true)
  })

  test("binds outer globals that programs can read or shadow while keeping line numbers", async () => {
    const read = await Effect.runPromise(
      CodeMode.execute({
        code: "return { prev: state.count, runs, same: input.state.count }",
        bindings: { state: { count: 4 }, runs: 2, input: { state: { count: 4 } } },
      }),
    )
    expect(read).toMatchObject({ ok: true, value: { prev: 4, runs: 2, same: 4 } })

    const shadowed = await Effect.runPromise(
      CodeMode.execute({
        code: "const state = 9\nreturn { wake: true, state }",
        bindings: { state: { count: 4 } },
      }),
    )
    expect(shadowed).toMatchObject({ ok: true, value: { wake: true, state: 9 } })
  })
})
