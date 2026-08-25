import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import {
  OpenCode,
  type AgentInfo,
  type CommandInfo,
  type ModelInfo,
  type ModelRef,
  type SessionInfo,
  type SkillInfo,
  type TokenUsageInfo,
} from "@opencode-ai/client/promise"
import { ACPService } from "../../src/acp/service"

export type FixtureRequest = {
  readonly method: string
  readonly path: string
  readonly query: Record<string, string>
  readonly body: unknown
}

export type FixtureContext = {
  readonly requests: FixtureRequest[]
  send(event: unknown): void
}

type FixtureHandler = (
  request: FixtureRequest,
  context: FixtureContext,
) => Response | undefined | Promise<Response | undefined>

type FixtureOptions = {
  readonly fetch?: FixtureHandler
  readonly models?: readonly ModelInfo[]
  readonly defaultModel?: ModelInfo
  readonly agents?: readonly AgentInfo[]
  readonly commands?: readonly CommandInfo[]
  readonly skills?: readonly SkillInfo[]
}

export const testModel = {
  id: "test-model",
  modelID: "test-model",
  providerID: "test",
  name: "Test Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "default" }, { id: "high" }],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 100_000, output: 10_000 },
} satisfies ModelInfo

export const secondModel = {
  id: "second-model",
  modelID: "second-model",
  providerID: "test",
  name: "Second Model",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "low" }, { id: "medium" }],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 200_000, output: 20_000 },
} satisfies ModelInfo

export const buildAgent = {
  id: "build",
  name: "Build",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary",
  hidden: false,
  permissions: [],
} satisfies AgentInfo

export const planAgent = {
  id: "plan",
  name: "Plan",
  description: "Plan first",
  request: { settings: {}, headers: {}, body: {} },
  mode: "primary",
  hidden: false,
  permissions: [],
} satisfies AgentInfo

export const reviewCommand = {
  name: "review",
  description: "Review changes",
} satisfies CommandInfo

export const verifySkill = {
  id: "verify",
  name: "verify",
  description: "Verify work",
  slash: true,
  location: "/skills/verify.md",
  content: "verify",
} satisfies SkillInfo

export function makeSession(
  id: string,
  input: {
    readonly cwd?: string
    readonly agent?: string
    readonly model?: ModelRef
    readonly cost?: number
    readonly tokens?: TokenUsageInfo
    readonly time?: SessionInfo["time"]
    readonly title?: string
  } = {},
): SessionInfo {
  return {
    id,
    projectID: "global",
    agent: input.agent ?? "build",
    model: input.model ?? { providerID: "test", id: "test-model", variant: "default" },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: input.time ?? { created: 0, updated: 0 },
    title: input.title ?? `Session ${id}`,
    location: { directory: input.cwd ?? "/workspace" },
  }
}

export function makeACPFixture(options: FixtureOptions = {}) {
  const requests: FixtureRequest[] = []
  const updates: Parameters<AgentSideConnection["sessionUpdate"]>[0][] = []
  const encoder = new TextEncoder()
  let eventController: ReadableStreamDefaultController<Uint8Array> | undefined
  const models = options.models ?? [testModel, secondModel]
  const context: FixtureContext = {
    requests,
    send(event) {
      if (!eventController) throw new Error("ACP fixture has no active event stream")
      eventController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
  }
  const server = Bun.serve({
    port: 0,
    async fetch(raw) {
      const url = new URL(raw.url)
      const request: FixtureRequest = {
        method: raw.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: raw.method === "GET" || raw.method === "HEAD" ? undefined : await raw.json().catch(() => undefined),
      }
      requests.push(request)
      const response = await options.fetch?.(request, context)
      if (response) return response

      const directory = request.query["location[directory]"] ?? "/workspace"
      const location = { directory, project: { id: "global", directory } }
      if (request.path === "/api/event") {
        let controller: ReadableStreamDefaultController<Uint8Array> | undefined
        return new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value
              eventController = value
              context.send({ id: "evt_connected", type: "server.connected", data: {} })
            },
            cancel() {
              if (eventController === controller) eventController = undefined
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      }
      if (request.path === "/api/model") return Response.json({ location, data: models })
      if (request.path === "/api/model/default") {
        return Response.json({ location, data: options.defaultModel ?? models[0] ?? null })
      }
      if (request.path === "/api/agent") {
        return Response.json({ location, data: options.agents ?? [buildAgent, planAgent] })
      }
      if (request.path === "/api/command") {
        return Response.json({ location, data: options.commands ?? [reviewCommand] })
      }
      if (request.path === "/api/skill") {
        return Response.json({ location, data: options.skills ?? [verifySkill] })
      }
      return new Response(null, { status: 404 })
    },
  })
  const service = ACPService.make({
    client: OpenCode.make({ baseUrl: server.url.toString() }),
    connection: {
      sessionUpdate: async (update) => {
        updates.push(update)
      },
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    },
  })

  return {
    service,
    requests,
    updates,
    async [Symbol.asyncDispose]() {
      eventController?.close()
      await server.stop(true)
    },
  }
}
