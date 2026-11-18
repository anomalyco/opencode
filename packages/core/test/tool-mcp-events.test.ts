import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { Mcp } from "@opencode/core/mcp/index"
import { McpClient } from "@opencode/core/mcp/client"
import type { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { McpEventTools } from "@opencode/core/tool/plugin/mcp-events"
import { Effect, Layer } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { eventProducer } from "./fixture/event-server"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { registerToolPlugin, toolIdentity, toolNodeReplacements } from "./lib/tool"

const it = testEffect(AppNodeBuilder.build(Tool.node, toolNodeReplacements()))

const setup = Effect.fnUntraced(function* (input: { flag?: string } = {}) {
  const producer = yield* eventProducer([
    {
      name: "job.finished",
      description: "A job ended",
      delivery: ["push"],
      inputSchema: {},
      payloadSchema: { type: "object" },
    },
  ])
  const connection = yield* McpClient.connect({
    server: "jobs",
    config: { type: "attached", transport: producer.client },
    directory: import.meta.dir,
    events: true,
  }).pipe(Effect.provide(hostEnvironmentLayer))
  const asserts: Permission.AssertInput[] = []
  yield* registerToolPlugin(McpEventTools.Plugin, {}).pipe(
    Effect.provide(permissionLayer({ assert: (input) => Effect.sync(() => void asserts.push(input)) })),
    Effect.provide(Flag.testLayer([], { overrides: input.flag ?? "mcp_events" })),
    Effect.provide(
      Layer.mock(Mcp.Service, {
        servers: () =>
          Effect.succeed([
            { name: "jobs", status: { status: "connected" } },
            { name: "offline", status: { status: "failed" } },
          ] as never),
        events: (server) => Effect.succeed(server === "jobs" ? connection.events : undefined),
      }),
    ),
  )
  const registry = yield* Tool.Service
  const list = (input: Record<string, unknown>) =>
    registry.snapshot([{ action: "execute", resource: "*", effect: "deny" }]).pipe(
      Effect.flatMap((tools) =>
        tools.execute({
          sessionID: Session.ID.make("ses_mcp_events"),
          ...toolIdentity,
          call: { type: "tool-call", id: "call_list", name: "opencode_list_mcp_events", input },
        }),
      ),
      Effect.orDie,
    )
  return { asserts, list, registry }
})

const jobFinished = {
  server: "jobs",
  name: "job.finished",
  description: "A job ended",
  delivery: ["push"],
  inputSchema: {},
  payloadSchema: { type: "object" },
}

describe("list_mcp_events", () => {
  it.live("is absent while the mcp_events flag is off", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup({ flag: "-mcp_events" })
      expect((yield* registry.list()).map((tool) => tool.id)).not.toContain("opencode_list_mcp_events")
    }),
  )

  it.live("lists the event types of connected servers after asking permission", () =>
    Effect.gen(function* () {
      const { list, asserts, registry } = yield* setup()
      expect((yield* registry.list()).map((tool) => tool.id)).not.toContain("opencode_watch_mcp_event")
      expect((yield* list({})).output).toEqual({ events: [jobFinished] })
      expect(asserts).toMatchObject([{ action: "opencode_list_mcp_events", resources: ["jobs"], save: ["jobs"] }])
    }),
  )

  it.live("lists none for a named server that offers no events", () =>
    Effect.gen(function* () {
      const { list } = yield* setup()
      expect((yield* list({ server: "offline" })).output).toEqual({ events: [] })
      expect((yield* list({ server: "jobs" })).output).toEqual({ events: [jobFinished] })
    }),
  )
})
