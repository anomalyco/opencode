import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ToolTimeout } from "@/tool/timeout"

const plugin = (ms: number | false): ToolTimeout.Limit => ({ ms, source: "tool default" })

describe("ToolTimeout.resolve", () => {
  test("falls back to 30 minutes", () => {
    expect(ToolTimeout.resolve({ tool: "webfetch" })).toEqual({ ms: 30 * 60 * 1000, source: "default" })
  })

  test("the configured default replaces 30 minutes, higher or lower", () => {
    for (const ms of [60_000, 4 * 3_600_000, false] as const)
      expect(ToolTimeout.resolve({ tool: "webfetch", config: { default: ms } })).toEqual({
        ms,
        source: "config: tool_timeout.default",
      })
  })

  test("a declared tool default beats the global limit, higher or lower", () => {
    for (const ms of [1000, 8 * 3_600_000, false] as const)
      expect(ToolTimeout.resolve({ tool: "slow", config: { default: 60_000 }, declared: plugin(ms) })).toEqual(
        plugin(ms),
      )
  })

  test("a user's per-tool setting beats a declared default, higher or lower", () => {
    for (const ms of [500, 10 * 3_600_000, false] as const)
      expect(
        ToolTimeout.resolve({ tool: "slow", config: { default: 60_000, slow: ms }, declared: plugin(5000) }),
      ).toEqual({ ms, source: "config: tool_timeout.slow" })
  })

  test("question, task and call_omo_agent have no limit unless configured per tool", () => {
    for (const tool of ["question", "task", "call_omo_agent"]) {
      expect(ToolTimeout.resolve({ tool, config: { default: 60_000 } })).toEqual({
        ms: false,
        source: "built-in default",
      })
      expect(ToolTimeout.resolve({ tool, config: { [tool]: 3_600_000 } })).toEqual({
        ms: 3_600_000,
        source: `config: tool_timeout.${tool}`,
      })
    }
  })

  test("the built-in file tools default to 10 minutes, or a lower tool_timeout.default", () => {
    for (const tool of ["read", "write", "edit", "grep", "glob"]) {
      const builtIn = {
        ms: ToolTimeout.FILE_TOOL_MS,
        source: `built-in default for ${tool}, set tool_timeout.${tool} to change it`,
      }
      expect(ToolTimeout.FILE_TOOL_MS).toBe(10 * 60 * 1000)
      expect(ToolTimeout.resolve({ tool })).toEqual(builtIn)
      expect(ToolTimeout.resolve({ tool, config: { default: 3_600_000 } })).toEqual(builtIn)
      expect(ToolTimeout.resolve({ tool, config: { default: false } })).toEqual(builtIn)
      expect(ToolTimeout.resolve({ tool, config: { default: 60_000 } })).toEqual({
        ms: 60_000,
        source: "config: tool_timeout.default",
      })
      expect(ToolTimeout.resolve({ tool, config: { [tool]: 3_600_000 } })).toEqual({
        ms: 3_600_000,
        source: `config: tool_timeout.${tool}`,
      })
    }
    expect(ToolTimeout.resolve({ tool: "read", declared: plugin(5000) })).toEqual(plugin(5000))
  })

  test("a plugin's own declaration replaces a built-in exemption", () => {
    expect(ToolTimeout.resolve({ tool: "call_omo_agent", declared: plugin(120_000) })).toEqual(plugin(120_000))
  })

  test("a per-call timeout raises the limit to that timeout plus grace", () => {
    expect(ToolTimeout.resolve({ tool: "bash", call: 2 * 3_600_000 })).toEqual({
      ms: 2 * 3_600_000 + ToolTimeout.CALL_GRACE_MS,
      source: "the call's own timeout argument",
    })
    expect(ToolTimeout.resolve({ tool: "bash", config: { default: 1000 }, call: 2000 }).ms).toBe(
      2000 + ToolTimeout.CALL_GRACE_MS,
    )
  })

  test("a per-call timeout never lowers the limit or lifts a user's per-tool setting", () => {
    expect(ToolTimeout.resolve({ tool: "bash", call: 1000 })).toEqual({ ms: 30 * 60 * 1000, source: "default" })
    expect(ToolTimeout.resolve({ tool: "bash", config: { default: false }, call: 1000 }).ms).toBe(false)
    expect(ToolTimeout.resolve({ tool: "bash", config: { bash: 5000 }, call: 3_600_000 })).toEqual({
      ms: 5000,
      source: "config: tool_timeout.bash",
    })
  })

  test("only own config keys name tools", () => {
    expect(ToolTimeout.resolve({ tool: "constructor", config: {} }).source).toBe("default")
  })
})

describe("ToolTimeout.format", () => {
  test("reads like a duration", () => {
    expect(ToolTimeout.format(30 * 60 * 1000)).toBe("30m")
    expect(ToolTimeout.format(5_400_500)).toBe("1h30m500ms")
    expect(ToolTimeout.format(250)).toBe("250ms")
  })
})

describe("ToolTimeout.run", () => {
  test("ends a call that never finishes, aborting its signal and interrupting its fiber", async () => {
    const seen = { signal: undefined as AbortSignal | undefined, interrupted: false }
    const result = ToolTimeout.run({ ms: 50, source: "tool default" }, undefined, (call) => {
      seen.signal = call.signal
      return Effect.runFork(Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (seen.interrupted = true)))))
    })
    await expect(result).rejects.toThrow("tool call exceeded its 50ms limit (tool default)")
    expect(seen.signal?.aborted).toBe(true)
    await Bun.sleep(10)
    expect(seen.interrupted).toBe(true)
  })

  test("returns the result of a call that finishes in time", async () => {
    const result = await ToolTimeout.run({ ms: 1000, source: "default" }, undefined, () =>
      Effect.runFork(Effect.succeed("ok")),
    )
    expect(result).toBe("ok")
  })

  test("time spent in hold does not count", async () => {
    const result = await ToolTimeout.run({ ms: 100, source: "default" }, undefined, (call) =>
      Effect.runFork(call.hold(Effect.promise(() => Bun.sleep(250))).pipe(Effect.as("answered"))),
    )
    expect(result).toBe("answered")
  })

  test("forwards an abort of the turn without ending the call itself", async () => {
    const parent = new AbortController()
    const result = ToolTimeout.run({ ms: false, source: "default" }, parent.signal, (call) =>
      Effect.runFork(
        Effect.callback<string>((resume) => {
          call.signal.addEventListener("abort", () => resume(Effect.succeed("stopped by the turn")))
        }),
      ),
    )
    parent.abort()
    expect(await result).toBe("stopped by the turn")
  })
})
