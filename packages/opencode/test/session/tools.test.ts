import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionTools } from "@/session/tools"
import { MessageID, SessionID } from "@/session/schema"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { MCP } from "@/mcp"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { testEffect } from "../lib/effect"

const resourceClient = {
  getServerCapabilities() {
    return { resources: {} }
  },
}

const baseLayer = Layer.mergeAll(
  Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: ((_name: unknown, _input: unknown, output: unknown) =>
        Effect.succeed(output)) as Plugin.Interface["trigger"],
    }),
  ),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed([]),
      all: () => Effect.succeed([]),
      tools: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
    }),
  ),
  Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      status: () => Effect.succeed({}),
      clients: () => Effect.succeed({ docs: resourceClient as never }),
      instructions: () => Effect.succeed([]),
      tools: () => Effect.succeed({}),
      prompts: () => Effect.succeed({}),
      resources: () => Effect.succeed({}),
      resourceTemplates: () => Effect.succeed({}),
      add: () => Effect.succeed({ status: {} }),
      connect: () => Effect.void,
      disconnect: () => Effect.void,
      getPrompt: () => Effect.succeed(undefined),
      readResource: () => Effect.succeed({ contents: [{ uri: "file://docs/one.md", text: "hello" }] }),
      startAuth: () => Effect.die("unused"),
      authenticate: () => Effect.die("unused"),
      finishAuth: () => Effect.die("unused"),
      removeAuth: () => Effect.void,
      supportsOAuth: () => Effect.succeed(false),
      hasStoredTokens: () => Effect.succeed(false),
      getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    }),
  ),
  Layer.succeed(
    Truncate.Service,
    Truncate.Service.of({
      cleanup: () => Effect.void,
      write: (text) => Effect.succeed(text),
      output: (text) => Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 1000, maxBytes: 1_000_000 }),
    }),
  ),
  RuntimeFlags.layer(),
)

const it = testEffect(baseLayer)

it.effect("read_mcp_resource remember scope stays bound to the requested URI", () => {
  const asks: PermissionV1.AskInput[] = []
  return Effect.gen(function* () {
    const tools = yield* SessionTools.resolve({
      agent: {
        name: "build",
        permission: [],
        mode: "primary",
        options: {},
      } as never,
      model: {
        id: ModelV2.ID.make("test-model"),
        providerID: ProviderV2.ID.make("test"),
        api: { id: "test-model" },
      } as never,
      session: { id: SessionID.make("ses_test"), permission: [] } as never,
      processor: {
        message: { id: MessageID.make("msg_test") },
        updateToolCall: () => Effect.succeed(undefined),
        completeToolCall: () => Effect.void,
      } as never,
      bypassAgentCheck: false,
      messages: [],
      promptOps: {} as never,
    })

    yield* Effect.promise(() =>
      tools.read_mcp_resource.execute?.(
        { server: "docs", uri: "file://docs/one.md" },
        {
          toolCallId: "call_test",
          abortSignal: new AbortController().signal,
          messages: [],
        },
      ),
    )

    expect(asks).toHaveLength(1)
    expect(asks[0].patterns).toEqual(["mcp:docs:file://docs/one.md"])
    expect(asks[0].always).toEqual(["mcp:docs:file://docs/one.md"])
  }).pipe(
    Effect.provideService(
      Permission.Service,
      Permission.Service.of({
        ask: (input) =>
          Effect.sync(() => {
            asks.push(input)
          }),
        reply: () => Effect.void,
        list: () => Effect.succeed([]),
      }),
    ),
  )
})
