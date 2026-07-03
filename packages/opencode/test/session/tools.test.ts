import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { McpCatalog } from "@/mcp/catalog"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import * as Truncate from "@/tool/truncate"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, SessionID } from "@/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import type { Tool as AITool } from "ai"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

// Fake MCP.Service built through the same `convertTool` path the real service uses,
// so the raw registration loop dispatches through a genuine ai-sdk execute. The fake
// client answers every call with a small text result.
function fakeMcpLayer(tools: Record<string, { description: string }>) {
  const client = { callTool: async () => ({ content: [{ type: "text", text: "ok" }] }) }
  const converted: Record<string, AITool> = Object.fromEntries(
    Object.entries(tools).map(([key, def]) => [
      key,
      McpCatalog.convertTool(
        {
          name: key,
          description: def.description,
          inputSchema: { type: "object", properties: {} },
        } as any,
        client as any,
      ),
    ]),
  )
  return Layer.mock(MCP.Service, {
    tools: () => Effect.succeed(converted),
    defs: () => Effect.succeed({}),
    clients: () => Effect.succeed({ github: { getServerCapabilities: () => undefined } } as any),
  })
}

const mcpToolsLayer = fakeMcpLayer({
  github_create_issue: { description: "Create an issue" },
  github_list_issues: { description: "List issues" },
})

const root = LayerNode.group([ToolRegistry.node, Agent.node, MCP.node, RuntimeFlags.node])
const withCodeMode = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalCodeMode: true })],
    [MCP.node, mcpToolsLayer],
  ]),
)
const withFlagOff = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [MCP.node, mcpToolsLayer],
  ]),
)

// Resolve the session tool record with the smallest honest stand-ins for the pieces
// resolve reads: a fabricated model (only providerID/api.id are consulted by the
// schema transform for these fixtures), a pass-through Truncate, an always-allow
// Permission, and an optionally-observing Plugin.trigger. Registry, MCP, and flags
// come from the compiled instance context.
function resolveTools(trigger?: Plugin.Interface["trigger"]) {
  return Effect.gen(function* () {
    const agents = yield* Agent.Service
    const agent = yield* agents.defaultInfo()
    return yield* SessionTools.resolve({
      agent,
      model: { providerID: "opencode", api: { id: "test" } } as any,
      session: { id: SessionID.make("ses_session-tools"), permission: [] } as any,
      processor: {
        message: { id: MessageID.make("msg_session-tools") } as any,
        updateToolCall: () => Effect.succeed(undefined),
        completeToolCall: () => Effect.void,
      },
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as any,
    })
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Permission.Service, { ask: () => Effect.void }),
        Layer.mock(Plugin.Service, {
          trigger:
            trigger ?? (((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"]),
        }),
        Layer.mock(Truncate.Service, {
          output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
        }),
      ),
    ),
  )
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("session.tools resolve", () => {
  withCodeMode.instance("code mode suppresses raw per-MCP registration behind the execute tool", () =>
    Effect.gen(function* () {
      const tools = yield* resolveTools()
      const ids = Object.keys(tools)
      expect(ids).toContain("execute")
      expect(ids).not.toContain("github_create_issue")
      expect(ids).not.toContain("github_list_issues")
    }),
  )

  withFlagOff.instance("without code mode the raw MCP tools register and execute is absent", () =>
    Effect.gen(function* () {
      const tools = yield* resolveTools()
      const ids = Object.keys(tools)
      expect(ids).not.toContain("execute")
      expect(ids).toContain("github_create_issue")
      expect(ids).toContain("github_list_issues")
    }),
  )

  withFlagOff.instance("legacy raw MCP execution fires plugin hooks keyed by the ai-sdk toolCallId", () =>
    Effect.gen(function* () {
      const events: { name: string; input: any; output: any }[] = []
      const trigger = ((name: unknown, input: unknown, output: unknown) =>
        Effect.sync(() => {
          events.push({ name: name as string, input, output })
          return output
        })) as Plugin.Interface["trigger"]
      const tools = yield* resolveTools(trigger)
      const raw = tools["github_create_issue"]!
      const result = yield* Effect.promise(() =>
        Promise.resolve(
          raw.execute!(
            { title: "x" },
            { toolCallId: "call_legacy", abortSignal: new AbortController().signal, messages: [] },
          ),
        ),
      )

      expect((result as any).output).toBe("ok")
      expect(events.map((e) => [e.name, e.input.tool, e.input.callID])).toEqual([
        ["tool.execute.before", "github_create_issue", "call_legacy"],
        ["tool.execute.after", "github_create_issue", "call_legacy"],
      ])
      expect(events[0]!.output).toEqual({ args: { title: "x" } })
      // The after hook receives the raw MCP result, before model-facing shaping.
      expect(events[1]!.output).toMatchObject({ content: [{ type: "text", text: "ok" }] })
    }),
  )
})
