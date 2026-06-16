import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { jsonSchema, type Tool as AITool } from "ai"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { ProviderV2 } from "@opencode-ai/core/provider"

import { SessionTools, classifyToolError } from "@/session/tools"
import { Tool, InvalidArgumentsError } from "@/tool/tool"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "@/mcp"
import { Truncate } from "@/tool/truncate"
import { Question } from "@/question"
import { SessionID, MessageID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// A plugin whose `trigger` records every hook invocation so tests can assert
// which of before/after/error fired (and with what payload). It can optionally
// throw inside `tool.execute.before` to simulate a plugin veto.
function recordingPlugin(options?: { vetoTool?: string; failAfterTool?: string }) {
  const calls: { name: string; input: any; output: any }[] = []
  const layer = Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: ((name: string, input: any, output: any) => {
        calls.push({ name, input, output })
        // The real Plugin.trigger runs each hook via `Effect.promise(async () => fn(...))`,
        // so a hook that throws surfaces as a failing Effect (defect) — not a sync throw.
        if (name === "tool.execute.before" && options?.vetoTool && input?.tool === options.vetoTool) {
          return Effect.die(new Error("vetoed by plugin"))
        }
        if (name === "tool.execute.after" && options?.failAfterTool && input?.tool === options.failAfterTool) {
          return Effect.die(new Error("after hook crashed"))
        }
        return Effect.succeed(output)
      }) as Plugin.Interface["trigger"],
    }),
  )
  return { calls, layer, names: () => calls.map((c) => c.name) }
}

const permissionLayer = Layer.succeed(
  Permission.Service,
  {
    ask: () => Effect.void,
    reply: () => Effect.void,
    list: () => Effect.succeed([]),
  } as unknown as Permission.Interface,
)

const truncateLayer = Layer.succeed(
  Truncate.Service,
  {
    output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
    write: (text: string) => Effect.succeed(text),
    cleanup: () => Effect.void,
    limits: () => Effect.succeed({ maxLines: 1000, maxBytes: 1000 }),
  } as unknown as Truncate.Interface,
)

function registryLayer(defs: Tool.Def[]) {
  return Layer.succeed(
    ToolRegistry.Service,
    {
      ids: () => Effect.succeed(defs.map((d) => d.id)),
      all: () => Effect.succeed(defs),
      named: () => Effect.die("not used"),
      tools: () => Effect.succeed(defs),
    } as unknown as ToolRegistry.Interface,
  )
}

function mcpLayer(tools: Record<string, AITool> = {}) {
  return Layer.succeed(MCP.Service, { tools: () => Effect.succeed(tools) } as unknown as MCP.Interface)
}

const emptyObjectSchema = { type: "object", properties: {}, additionalProperties: false } as const

// Minimal Provider.Model — only providerID and api.id are read on this path.
const model = { providerID: ProviderV2.ID.make("test"), api: { id: "test-model" } } as any

const resolveInput = () => ({
  agent: { name: "build", permission: [] } as any,
  model,
  session: { id: SessionID.make("ses_test"), permission: [] } as any,
  processor: {
    message: { id: MessageID.make("msg_test") },
    updateToolCall: () => Effect.void,
    completeToolCall: () => Effect.void,
  } as any,
  bypassAgentCheck: true,
  messages: [],
  promptOps: {} as any,
})

const baseLayers = (registry: Layer.Layer<ToolRegistry.Service>, plugin: Layer.Layer<Plugin.Service>, mcp = {}) =>
  Layer.mergeAll(plugin, permissionLayer, truncateLayer, registry, mcpLayer(mcp))

const it = testEffect(Layer.empty)

function builtinTool(id: string, execute: Tool.Def["execute"]): Tool.Def {
  return {
    id,
    description: id,
    parameters: {} as any,
    jsonSchema: emptyObjectSchema as any,
    execute,
  }
}

const callOptions = (callID: string) => ({
  toolCallId: callID,
  abortSignal: new AbortController().signal,
  messages: [],
})

describe("classifyToolError", () => {
  it.effect("marks generic tool errors retryable with tool authority", () =>
    Effect.sync(() => {
      const info = classifyToolError(new Error("boom"))
      expect(info).toEqual({ error: "boom", retryable: true, authority: "tool" })
    }),
  )

  it.effect("marks permission rejections non-retryable with runtime authority", () =>
    Effect.sync(() => {
      const info = classifyToolError(new PermissionV1.RejectedError({ permission: "edit", callID: "c" } as any))
      expect(info.retryable).toBe(false)
      expect(info.authority).toBe("runtime")
    }),
  )

  it.effect("marks question rejections non-retryable with runtime authority", () =>
    Effect.sync(() => {
      const info = classifyToolError(new Question.RejectedError({} as any))
      expect(info.retryable).toBe(false)
      expect(info.authority).toBe("runtime")
    }),
  )

  it.effect("marks invalid arguments non-retryable with tool authority", () =>
    Effect.sync(() => {
      const info = classifyToolError(new InvalidArgumentsError({ tool: "read", detail: "bad" }))
      expect(info.retryable).toBe(false)
      expect(info.authority).toBe("tool")
    }),
  )

  it.effect("forces plugin authority when requested", () =>
    Effect.sync(() => {
      const info = classifyToolError(new Error("vetoed"), "plugin")
      expect(info.authority).toBe("plugin")
    }),
  )
})

describe("tool.execute.error (builtin path)", () => {
  it.effect("fires before+after, not error, on success", () => {
    const plugin = recordingPlugin()
    const registry = registryLayer([
      builtinTool("ok", () => Effect.succeed({ title: "ok", metadata: {}, output: "done" })),
    ])
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      yield* Effect.promise(() => (tools["ok"].execute as any)({}, callOptions("call_ok")))
      expect(plugin.names()).toEqual(["tool.execute.before", "tool.execute.after"])
      expect(plugin.names()).not.toContain("tool.execute.error")
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer)))
  })

  it.effect("fires before+error, not after, on failure, with matching callID", () => {
    const plugin = recordingPlugin()
    const registry = registryLayer([builtinTool("fail", () => Effect.die(new Error("boom")))])
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      const exit = yield* Effect.promise(() =>
        (tools["fail"].execute as any)({}, callOptions("call_fail")).then(
          () => "resolved",
          (e: unknown) => e,
        ),
      )
      expect(exit).not.toBe("resolved")
      expect(plugin.names()).toEqual(["tool.execute.before", "tool.execute.error"])
      const error = plugin.calls.find((c) => c.name === "tool.execute.error")!
      expect(error.input.callID).toBe("call_fail")
      expect(error.input.tool).toBe("fail")
      expect(error.output).toEqual({ error: "boom", retryable: true, authority: "tool" })
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer)))
  })

  it.effect("fires error with plugin authority when a before-hook vetoes", () => {
    const plugin = recordingPlugin({ vetoTool: "veto" })
    let executed = false
    const registry = registryLayer([
      builtinTool("veto", () =>
        Effect.sync(() => {
          executed = true
          return { title: "veto", metadata: {}, output: "done" }
        }),
      ),
    ])
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      yield* Effect.promise(() => (tools["veto"].execute as any)({}, callOptions("call_veto")).catch(() => {}))
      expect(executed).toBe(false)
      const error = plugin.calls.find((c) => c.name === "tool.execute.error")
      expect(error).toBeDefined()
      expect(error!.output.authority).toBe("plugin")
      expect(plugin.names()).not.toContain("tool.execute.after")
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer)))
  })

  it.effect("fires error with plugin authority when an after-hook crashes", () => {
    const plugin = recordingPlugin({ failAfterTool: "ok" })
    const registry = registryLayer([
      builtinTool("ok", () => Effect.succeed({ title: "ok", metadata: {}, output: "done" })),
    ])
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      yield* Effect.promise(() => (tools["ok"].execute as any)({}, callOptions("call_after")).catch(() => {}))
      expect(plugin.names()).toEqual(["tool.execute.before", "tool.execute.after", "tool.execute.error"])
      const error = plugin.calls.find((c) => c.name === "tool.execute.error")!
      expect(error.output.authority).toBe("plugin")
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer)))
  })
})

describe("tool.execute.error (MCP path)", () => {
  function mcpTool(execute: (args: any, opts: any) => Promise<any>): AITool {
    return { inputSchema: jsonSchema(emptyObjectSchema as any), execute } as unknown as AITool
  }

  it.effect("fires before+after, not error, on success", () => {
    const plugin = recordingPlugin()
    const registry = registryLayer([])
    const mcp = {
      mcp_ok: mcpTool(async () => ({ content: [{ type: "text", text: "ok" }], metadata: {} })),
    }
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      yield* Effect.promise(() => (tools["mcp_ok"].execute as any)({}, callOptions("call_mcp_ok")))
      expect(plugin.names()).toEqual(["tool.execute.before", "tool.execute.after"])
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer, mcp)))
  })

  it.effect("fires before+error, not after, on failure", () => {
    const plugin = recordingPlugin()
    const registry = registryLayer([])
    const mcp = {
      mcp_fail: mcpTool(async () => {
        throw new Error("mcp boom")
      }),
    }
    return Effect.gen(function* () {
      const tools = yield* SessionTools.resolve(resolveInput())
      yield* Effect.promise(() => (tools["mcp_fail"].execute as any)({}, callOptions("call_mcp_fail")).catch(() => {}))
      expect(plugin.names()).toEqual(["tool.execute.before", "tool.execute.error"])
      const error = plugin.calls.find((c) => c.name === "tool.execute.error")!
      expect(error.input.tool).toBe("mcp_fail")
      expect(error.output.error).toBe("mcp boom")
    }).pipe(Effect.provide(baseLayers(registry, plugin.layer, mcp)))
  })
})
