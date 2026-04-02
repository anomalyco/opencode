import { describe, expect, test } from "bun:test"
import { Hook } from "../../src/hook/hook"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRuntime(hooks: Hook.HookDef[]) {
  return ManagedRuntime.make(
    Layer.mergeAll(Hook.layer, Bus.layer).pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(
        Layer.mock(Config.Service)({
          get: Effect.fn("TestConfig.get")(() => Effect.succeed({ hooks } as any)),
          getGlobal: Effect.fn("TestConfig.getGlobal")(() => Effect.succeed({} as any)),
          update: Effect.fn("TestConfig.update")(() => Effect.void),
          updateGlobal: Effect.fn("TestConfig.updateGlobal")(() => Effect.succeed({} as any)),
          invalidate: Effect.fn("TestConfig.invalidate")(() => Effect.void),
          directories: Effect.fn("TestConfig.directories")(() => Effect.succeed([])),
          waitForDependencies: Effect.fn("TestConfig.waitForDependencies")(() => Effect.void),
        }),
      ),
    ),
  )
}

// ─── matchesPattern ───────────────────────────────────────────────────────────

describe("hook.matchesPattern", () => {
  test("no pattern matches any tool", () => {
    expect(Hook.matchesPattern({ event: "tool.pre", command: "echo" }, "bash")).toBe(true)
    expect(Hook.matchesPattern({ event: "tool.pre", command: "echo" }, undefined)).toBe(true)
  })

  test("plain pattern matches matching tool", () => {
    const h: Hook.HookDef = { event: "tool.pre", pattern: "bash", command: "echo" }
    expect(Hook.matchesPattern(h, "bash")).toBe(true)
    expect(Hook.matchesPattern(h, "Bash")).toBe(true)
    expect(Hook.matchesPattern(h, "grep")).toBe(false)
  })

  test("fancy pattern Bash(git:*) matches bash tool", () => {
    const h: Hook.HookDef = { event: "tool.pre", pattern: "Bash(git:*)", command: "echo" }
    expect(Hook.matchesPattern(h, "bash")).toBe(true)
    // does NOT match grep
    expect(Hook.matchesPattern(h, "grep")).toBe(false)
  })

  test("fancy pattern with no toolName returns false", () => {
    const h: Hook.HookDef = { event: "tool.pre", pattern: "Bash(git:*)", command: "echo" }
    expect(Hook.matchesPattern(h, undefined)).toBe(false)
  })
})

// ─── Hook.run ─────────────────────────────────────────────────────────────────

describe("hook.run", () => {
  test("continue when command outputs nothing", async () => {
    const result = await Hook.run({ event: "tool.pre", command: "true" })
    expect(result.directive).toBe("continue")
  })

  test("continue when command outputs non-JSON", async () => {
    const result = await Hook.run({ event: "tool.pre", command: "echo 'hello world'" })
    expect(result.directive).toBe("continue")
  })

  test("block when command outputs {directive: 'block'}", async () => {
    const result = await Hook.run({ event: "tool.pre", command: `echo '{"directive":"block"}'` })
    expect(result.directive).toBe("block")
  })

  test("approve when command outputs {directive: 'approve'}", async () => {
    const result = await Hook.run({ event: "tool.pre", command: `echo '{"directive":"approve"}'` })
    expect(result.directive).toBe("approve")
  })

  test("env vars are passed to command", async () => {
    const result = await Hook.run(
      { event: "tool.pre", command: `test "$MY_VAR" = "hello" && echo '{"directive":"approve"}' || echo '{}'` },
      { MY_VAR: "hello" },
    )
    expect(result.directive).toBe("approve")
  })

  test("continue on timeout", async () => {
    const result = await Hook.run({ event: "tool.pre", command: "sleep 10", timeout: 100 })
    expect(result.directive).toBe("continue")
  })
})

// ─── Hook.Service.fire ────────────────────────────────────────────────────────

describe("hook.fire", () => {
  test("returns continue when no hooks configured", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("continue")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("runs matching hooks and returns continue", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "tool.pre", command: "true" }])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("continue")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("skips hooks for different events", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "session.start", command: `echo '{"directive":"block"}'` }])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("continue")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("returns block when a hook blocks", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "tool.pre", command: `echo '{"directive":"block"}'` }])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("block")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("returns approve when a hook approves", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "tool.pre", command: `echo '{"directive":"approve"}'` }])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("approve")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("block stops further hook execution", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // second hook would approve but first blocks
        const rt = makeRuntime([
          { event: "tool.pre", command: `echo '{"directive":"block"}'` },
          { event: "tool.pre", command: `echo '{"directive":"approve"}'` },
        ])
        try {
          const result = await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          expect(result.directive).toBe("block")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("pattern matching filters hooks by tool name", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "tool.pre", pattern: "grep", command: `echo '{"directive":"block"}'` }])
        try {
          // bash tool — should NOT match grep hook
          const result = await rt.runPromise(
            Hook.Service.use((svc) => svc.fire({ event: "tool.pre", toolName: "bash" })),
          )
          expect(result.directive).toBe("continue")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("publishes hook.ran event", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const rt = makeRuntime([{ event: "tool.pre", command: "true" }])
        let seen = false
        try {
          const unsub = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(Hook.Event.Ran, () => {
                seen = true
              }),
            ),
          )
          await rt.runPromise(Hook.Service.use((svc) => svc.fire({ event: "tool.pre" })))
          await new Promise((r) => setTimeout(r, 50))
          unsub()
          expect(seen).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})
