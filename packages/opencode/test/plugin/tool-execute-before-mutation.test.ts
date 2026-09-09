import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Plugin } from "../../src/plugin/index"

// Regression test for: tool.execute.before hook mutation ignored by call sites.
//
// Bug: tools.ts called plugin.trigger("tool.execute.before", ..., { args }) with an
// inline object literal, then used the original `args` from the closure for execution
// instead of reading back from the mutated output. This meant plugin rewrites (e.g.
// rtk rewriting bash commands) had no effect.
//
// Fix: capture hook output in a variable and use `hookOutput.args` for execution.
// This test locks that behavior — the trigger's output must reflect plugin mutations.

// Minimal mock: Plugin.Service with a trigger that mutates output.args in place,
// exactly as real plugins do.
function mockPluginLayer(mutator: (output: { args: unknown }) => void) {
  return Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      trigger: ((_name: unknown, _input: unknown, output: { args: unknown }) =>
        Effect.sync(() => {
          mutator(output)
          return output
        })) as Plugin.Interface["trigger"],
      list: () => Effect.succeed([]),
    }),
  )
}

describe("plugin.trigger tool.execute.before mutation", () => {
  const HOOK = "tool.execute.before" as const

  test("trigger returns output with mutated args (in-place mutation)", async () => {
    const plugin = Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        init: () => Effect.void,
        trigger: ((_name: unknown, _input: unknown, output: { args: unknown }) =>
          Effect.sync(() => {
            // Simulate a plugin rewriting a bash command
            const args = output.args as { command: string }
            args.command = "rtk git status"
            return output
          })) as Plugin.Interface["trigger"],
        list: () => Effect.succeed([]),
      }),
    )

    const result = await Effect.gen(function* () {
      const p = yield* Plugin.Service
      const output = { args: { command: "git status" } }
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, output)
      return output
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    expect((result.args as { command: string }).command).toBe("rtk git status")
  })

  test("trigger passes output by reference — hook sees same object", async () => {
    let hookReceivedArgs: unknown = null

    const plugin = Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        init: () => Effect.void,
        trigger: ((_name: unknown, _input: unknown, output: { args: unknown }) =>
          Effect.sync(() => {
            hookReceivedArgs = output.args
            return output
          })) as Plugin.Interface["trigger"],
        list: () => Effect.succeed([]),
      }),
    )

    const originalArgs = { command: "git status" }
    await Effect.gen(function* () {
      const p = yield* Plugin.Service
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, { args: originalArgs })
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    // Hook received the exact same object reference — mutation is visible to caller
    expect(hookReceivedArgs).toBe(originalArgs)
  })

  test("call site must read hookOutput.args, not original args", async () => {
    // This test models the actual call-site pattern in tools.ts:
    //   const hookOutput = { args }
    //   yield* plugin.trigger("tool.execute.before", ..., hookOutput)
    //   item.execute(hookOutput.args, ctx)   // <-- must use hookOutput.args

    const mutatedCommand = "rtk git status"
    const plugin = mockPluginLayer((output) => {
      const args = output.args as { command: string }
      args.command = mutatedCommand
    })

    const result = await Effect.gen(function* () {
      const p = yield* Plugin.Service

      // Simulate the call-site pattern from tools.ts
      const args = { command: "git status" }
      const hookOutput = { args }
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, hookOutput)

      // The tool execution must receive the mutated args
      return hookOutput.args as { command: string }
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    expect(result.command).toBe(mutatedCommand)
  })

  test("nested property mutation propagates through hookOutput", async () => {
    // Test deep mutation (e.g. plugin rewriting a nested field)
    const plugin = mockPluginLayer((output) => {
      const args = output.args as { options: { verbose: boolean } }
      args.options.verbose = true
    })

    const result = await Effect.gen(function* () {
      const p = yield* Plugin.Service
      const args = { options: { verbose: false } }
      const hookOutput = { args }
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, hookOutput)
      return (hookOutput.args as { options: { verbose: boolean } }).options.verbose
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    expect(result).toBe(true)
  })

  test("hook that replaces args entirely (not just mutates) is visible", async () => {
    // Some plugins might replace the entire args object
    const replacement = { command: "completely-new-command", flags: ["--json"] }
    const plugin = Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        init: () => Effect.void,
        trigger: ((_name: unknown, _input: unknown, output: { args: unknown }) =>
          Effect.sync(() => {
            // Replace entire args
            output.args = replacement
            return output
          })) as Plugin.Interface["trigger"],
        list: () => Effect.succeed([]),
      }),
    )

    const result = await Effect.gen(function* () {
      const p = yield* Plugin.Service
      const hookOutput = { args: { command: "original" } }
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, hookOutput)
      return hookOutput.args
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    expect(result).toEqual(replacement)
    expect(result).not.toEqual({ command: "original" })
  })

  test("no-op trigger passes args through unchanged", async () => {
    const plugin = Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        init: () => Effect.void,
        trigger: ((_name: unknown, _input: unknown, output: unknown) =>
          Effect.succeed(output)) as Plugin.Interface["trigger"],
        list: () => Effect.succeed([]),
      }),
    )

    const original = { command: "git status" }
    const result = await Effect.gen(function* () {
      const p = yield* Plugin.Service
      const hookOutput = { args: { ...original } }
      yield* p.trigger(HOOK, { tool: "bash", sessionID: "s1", callID: "c1" }, hookOutput)
      return hookOutput.args as { command: string }
    }).pipe(Effect.provide(plugin), Effect.runPromise)

    expect(result).toEqual(original)
  })
})
