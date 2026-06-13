import { fileURLToPath } from "url"
import { describe, expect, spyOn, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"

const delegatePlugin = new URL("../fixture/trade-context-mode-delegate-plugin.ts", import.meta.url).href
const invalidToolShapeDelegate = new URL(
  "../fixture/trade-context-mode-delegate-invalid-tool-plugin.ts",
  import.meta.url,
).href

const loadPlugin = async (mode?: string, delegate?: string) => {
  const previous = process.env.OPENCODE_TRADE_CONTEXT_MODE
  const previousDelegate = process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE
  if (mode === undefined) {
    delete process.env.OPENCODE_TRADE_CONTEXT_MODE
  } else {
    process.env.OPENCODE_TRADE_CONTEXT_MODE = mode
  }

  if (delegate === undefined) {
    delete process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE
  } else if (delegate.length === 0) {
    delete process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE
  } else {
    process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE = delegate
  }

  try {
    const pluginModule = await import("../../../../.opencode/plugins/trade-context-mode")
    const pluginInput = {
      client: {},
      project: {},
      directory: process.cwd(),
      worktree: process.cwd(),
      experimental_workspace: {
        register: () => {},
      },
      serverUrl: new URL("http://localhost"),
      $: {},
    } as unknown as Parameters<typeof pluginModule.default>[0]
    const pluginOptions = {} as Parameters<typeof pluginModule.default>[1]
    return (await pluginModule.default(pluginInput, pluginOptions)) as Partial<Hooks>
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_TRADE_CONTEXT_MODE
    else process.env.OPENCODE_TRADE_CONTEXT_MODE = previous
    if (previousDelegate === undefined) delete process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE
    else process.env.OPENCODE_TRADE_CONTEXT_MODE_DELEGATE = previousDelegate
  }
}

const withWarnSuppressed = async <T>(input: () => Promise<T>) => {
  const spy = spyOn(console, "warn").mockImplementation(() => {})
  try {
    return await input()
  } finally {
    spy.mockRestore()
  }
}

const withWarnCapture = async <T>(input: () => Promise<T>) => {
  const spy = spyOn(console, "warn").mockImplementation(() => {})
  try {
    const result = await input()
    return { result, calls: spy.mock.calls.length }
  } finally {
    spy.mockRestore()
  }
}

describe("trade-context-mode plugin", () => {
  test("off mode returns no hooks", async () => {
    const hooks = await loadPlugin("off")
    expect(Object.keys(hooks).length).toBe(0)
    expect(Object.keys(hooks)).toEqual([])
  })

  test("off mode does not attempt delegate import", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("off", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBe(0)
  })

  test("unset mode returns no hooks", async () => {
    const hooks = await loadPlugin()
    expect(Object.keys(hooks)).toEqual([])
  })

  test("empty/invalid mode returns no hooks", async () => {
    const hooks = await loadPlugin("\t")
    expect(Object.keys(hooks).length).toBe(0)
    expect(Object.keys(hooks)).toEqual([])
  })

  test("tools mode returns no hooks", async () => {
    const hooks = await loadPlugin("tools")
    expect(Object.keys(hooks).length).toBe(0)
    expect(Object.keys(hooks)).toEqual([])
  })

  test("shadow mode registers tool.execute.after hook", async () => {
    const hooks = await loadPlugin("shadow")
    expect(Object.keys(hooks)).toEqual(["tool.execute.after"])
    expect(typeof hooks["tool.execute.after"]).toBe("function")
  })

  test("mode parsing is case-insensitive", async () => {
    const hooks = await loadPlugin("ShAdOw")
    expect(typeof hooks["tool.execute.after"]).toBe("function")
  })

  test("shadow tool hook is fail-open", async () => {
    const hooks = await loadPlugin("shadow")
    await expect((hooks["tool.execute.after"] as (() => Promise<void>) | undefined)?.()).resolves.toBeUndefined()
  })

  test("tools mode forwards only ctx_* tools from delegate", async () => {
    const hooks = await loadPlugin("tools", delegatePlugin)

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool).toHaveProperty("ctx_search")
    expect(hooks.tool).not.toHaveProperty("non_ctx_search")
    expect(typeof hooks["tool.execute.after"]).toBe("undefined")
  })

  test("tools mode ignores non-function tool.execute.after from delegate", async () => {
    const nonFunctionHookDelegate = new URL("../fixture/trade-context-mode-delegate-nonfn-plugin.ts", import.meta.url).href
    const hooks = await loadPlugin("tools", nonFunctionHookDelegate)

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool).toHaveProperty("ctx_search")
    expect((hooks as Record<string, unknown>)["tool.execute.after"]).toBeUndefined()
  })

  test("tools mode ignores malformed ctx_ tool entries", async () => {
    const hooks = await loadPlugin("tools", invalidToolShapeDelegate)

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool).toHaveProperty("ctx_stats")
    expect(hooks.tool).not.toHaveProperty("ctx_search")
    expect(hooks.tool).not.toHaveProperty("other_search")
  })

  test("tools mode exposes no non-tool hooks", async () => {
    const hooks = await loadPlugin("tools", delegatePlugin)

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect((hooks as Record<string, unknown>)["experimental.chat.system.transform"]).toBeUndefined()
    expect((hooks as Record<string, unknown>)["tool.execute.before"]).toBeUndefined()
    expect((hooks as Record<string, unknown>)["tool.execute.after"]).toBeUndefined()
  })

  test("unknown mode falls back to off", async () => {
    const hooks = await loadPlugin("on")
    expect(Object.keys(hooks)).toEqual([])
  })

  test("unknown mode should not attempt delegate import", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("on", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBe(0)
  })

  test("case-insensitive unknown mode should not attempt delegate import", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("On", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBe(0)
  })

  test("unknown mode ignores delegate even when configured", async () => {
    const out = await withWarnCapture(() => loadPlugin("strict", "file:///tmp/non-existent-context-mode-delegate.js"))

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBe(0)
  })

  test("case-insensitive strict-like mode should ignore delegate", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("StRiCt", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBe(0)
  })

  test("strict mode falls back to off", async () => {
    const hooks = await loadPlugin("strict")
    expect(Object.keys(hooks)).toEqual([])
  })

  test("tools mode resolves relative delegate path", async () => {
    const hooks = await loadPlugin("tools", "./test/fixture/trade-context-mode-delegate-plugin.ts")

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool).toHaveProperty("ctx_search")
    expect(hooks.tool).not.toHaveProperty("non_ctx_search")
  })

  test("tools mode resolves absolute delegate path", async () => {
    const absoluteDelegate = fileURLToPath(new URL("../fixture/trade-context-mode-delegate-plugin.ts", import.meta.url))
    const hooks = await loadPlugin("tools", absoluteDelegate)

    expect(Object.keys(hooks)).toEqual(["tool"])
    expect(hooks.tool).toBeDefined()
    expect(hooks.tool).toHaveProperty("ctx_search")
    expect(hooks.tool).not.toHaveProperty("non_ctx_search")
  })

  test("shadow mode uses delegated hook and fail-opens on throw", async () => {
    const hooks = await withWarnSuppressed(() => loadPlugin("shadow", delegatePlugin))
    expect(Object.keys(hooks)).toEqual(["tool.execute.after"])
    await withWarnSuppressed(async () =>
      expect((hooks["tool.execute.after"] as (() => Promise<void>) | undefined)?.()).resolves.toBeUndefined(),
    )
  })

  test("shadow mode falls back to noop when delegated after-hook is not function", async () => {
    const nonFunctionHookDelegate = new URL("../fixture/trade-context-mode-delegate-nonfn-plugin.ts", import.meta.url).href
    const out = await withWarnCapture(() => loadPlugin("shadow", nonFunctionHookDelegate))

    expect(Object.keys(out.result)).toEqual(["tool.execute.after"])
    expect(typeof out.result["tool.execute.after"]).toBe("function")
    expect(out.calls).toBe(0)

    await expect(
      (out.result["tool.execute.after"] as (() => Promise<void>) | undefined)?.(),
    ).resolves.toBeUndefined()
  })

  test("invalid delegate path fails open to local fallback in shadow mode", async () => {
    const hooks = await withWarnSuppressed(() => loadPlugin("shadow", "file:///tmp/non-existent-context-mode-delegate.js"))

    expect(Object.keys(hooks)).toEqual(["tool.execute.after"])
    await withWarnSuppressed(async () =>
      expect((hooks["tool.execute.after"] as (() => Promise<void>) | undefined)?.()).resolves.toBeUndefined(),
    )
  })

  test("invalid delegate path is harmless in tools mode", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("tools", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual([])
    expect(out.calls).toBeGreaterThan(0)
  })

  test("invalid delegate path warns in shadow mode", async () => {
    const out = await withWarnCapture(() =>
      loadPlugin("shadow", "file:///tmp/non-existent-context-mode-delegate.js"),
    )

    expect(Object.keys(out.result)).toEqual(["tool.execute.after"])
    expect(out.calls).toBeGreaterThan(0)
  })
})
