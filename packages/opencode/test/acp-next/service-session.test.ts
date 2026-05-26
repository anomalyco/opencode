import { describe, expect, it } from "bun:test"
import type {
  AgentSideConnection,
  ForkSessionResponse,
  LoadSessionResponse,
  NewSessionResponse,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionConfigSelectOption,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect, ManagedRuntime } from "effect"
import * as ACPNextService from "@/acp-next/service"
import * as ACPNextError from "@/acp-next/error"
import { ACPNextSession } from "@/acp-next/session"
import { ModelID, ProviderID } from "@/provider/schema"
import type { Provider } from "@/provider/provider"

const providerID = ProviderID.make("test")
const modelID = ModelID.make("test-model")
const configuredModelID = ModelID.make("configured-model")
const secondModelID = ModelID.make("second-model")

const provider: Provider.Info = {
  id: providerID,
  name: "Test",
  source: "config",
  env: [],
  options: {},
  models: {
    [modelID]: {
      id: modelID,
      providerID,
      api: {
        id: modelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Test Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {
        default: {},
        high: { reasoningEffort: "high" },
      },
    },
    [configuredModelID]: {
      id: configuredModelID,
      providerID,
      api: {
        id: configuredModelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Configured Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
    [secondModelID]: {
      id: secondModelID,
      providerID,
      api: {
        id: secondModelID,
        url: "https://example.com",
        npm: "@ai-sdk/openai-compatible",
      },
      name: "Second Model",
      family: "test",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: { read: 0, write: 0 },
      },
      limit: {
        context: 128000,
        output: 4096,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
      },
    },
  },
}

describe("ACP next service sessions", () => {
  const makeService = (messages: readonly { info: unknown; parts: readonly unknown[] }[] = []) => {
    const updates: unknown[] = []
    const mcpAdds: string[] = []
    const aborts: string[] = []
    const forks: string[] = []
    const sessions = Array.from({ length: 102 }, (_, index) => ({
      id: `ses_${index + 1}`,
      directory: index % 2 === 0 ? "/workspace" : "/other",
      title: `Session ${index + 1}`,
      time: { created: index + 1, updated: index + 1 },
    }))
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () =>
          Promise.resolve({
            data: [
              { name: "build", mode: "primary", permission: [], options: {} },
              { name: "plan", mode: "primary", description: "Plan first", permission: [], options: {} },
              { name: "hidden", mode: "primary", hidden: true, permission: [], options: {} },
            ],
          }),
        skills: () =>
          Promise.resolve({
            data: [{ name: "review-skill", description: "Review", location: "/skills/review", content: "review" }],
          }),
      },
      command: {
        list: () =>
          Promise.resolve({
            data: [{ name: "init", description: "Initialize", source: "command", template: "init", hints: [] }],
          }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_new" } }),
        get: () => Promise.resolve({ data: { id: "ses_loaded" } }),
        list: (input: { directory?: string }) =>
          Promise.resolve({
            data: input.directory ? sessions.filter((session) => session.directory === input.directory) : sessions,
          }),
        messages: () => Promise.resolve({ data: messages }),
        abort: (input: { sessionID: string }) => {
          aborts.push(input.sessionID)
          return Promise.resolve({ data: true })
        },
        fork: (input: { sessionID: string }) => {
          forks.push(input.sessionID)
          return Promise.resolve({ data: { id: `fork_${input.sessionID}` } })
        },
      },
      mcp: {
        add: (input: { name?: string }) => {
          if (input.name) mcpAdds.push(input.name)
          return Promise.resolve({ data: {} })
        },
      },
    } as unknown as OpencodeClient
    const connection = {
      sessionUpdate: (update: unknown) => {
        updates.push(update)
        return Promise.resolve()
      },
    } as Pick<AgentSideConnection, "sessionUpdate">

    return { service: ACPNextService.make({ sdk, connection }), updates, mcpAdds, aborts, forks }
  }

  it("creates a backed session with config options and command update", async () => {
    const { service, updates, mcpAdds } = makeService()
    const result = await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [
          { name: "tools", command: "node", args: ["server.js"], env: [] },
          { name: "tools", command: "node", args: ["server.js"], env: [] },
        ],
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(result.sessionId).toBe("ses_new")
    expect(categories(result)).toContain("model")
    expect(categories(result)).toContain("thought_level")
    expect(categories(result)).toContain("mode")
    expect(updates).toHaveLength(1)
    expect(JSON.stringify(updates[0])).toContain("available_commands_update")
    expect(JSON.stringify(updates[0])).toContain("review-skill")
    expect(mcpAdds).toEqual(["tools"])
  })

  it("loads a session and restores model variant and mode from messages", async () => {
    const { service } = makeService([
      {
        info: {
          role: "assistant",
          providerID: "test",
          modelID: "test-model",
          variant: "high",
          mode: "plan",
        },
        parts: [],
      },
    ])
    const result = await Effect.runPromise(
      service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }),
    )

    expect(result.configOptions?.find((option) => option.id === "effort")?.currentValue).toBe("high")
    expect(result.configOptions?.find((option) => option.id === "mode")?.currentValue).toBe("plan")
  })

  it("lists sessions sorted by updated time with cursor support", async () => {
    const { service } = makeService()
    const first = await Effect.runPromise(service.listSessions({ cwd: "/workspace" }))
    const second = await Effect.runPromise(service.listSessions({ cwd: "/workspace", cursor: first.nextCursor }))

    expect(first.sessions).toHaveLength(51)
    expect(first.sessions[0]?.sessionId).toBe("ses_101")
    expect(first.sessions.at(-1)?.sessionId).toBe("ses_1")
    expect(first.nextCursor).toBeUndefined()
    expect(second.sessions).toEqual(first.sessions)
  })

  it("lists all sessions with next cursor when the first page is full", async () => {
    const { service } = makeService()
    const first = await Effect.runPromise(service.listSessions({}))
    const second = await Effect.runPromise(service.listSessions({ cursor: first.nextCursor }))

    expect(first.sessions).toHaveLength(100)
    expect(first.sessions[0]?.sessionId).toBe("ses_102")
    expect(first.sessions.at(-1)?.sessionId).toBe("ses_3")
    expect(first.nextCursor).toBe("3")
    expect(second.sessions.map((session) => session.sessionId)).toEqual(["ses_2", "ses_1"])
  })

  it("resumes a session and stores restored state", async () => {
    const { service } = makeService([
      {
        info: {
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "high" },
          agent: "plan",
        },
        parts: [],
      },
    ])
    const resumed = await Effect.runPromise(
      service.resumeSession({ cwd: "/workspace", sessionId: "ses_resume", mcpServers: [] }),
    )
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({ sessionId: "ses_resume", configId: "effort", value: "default" }),
    )

    expect(select(resumed, "effort")?.currentValue).toBe("high")
    expect(select(updated, "effort")?.currentValue).toBe("default")
  })

  it("closes local ACP state and aborts the backing session best-effort", async () => {
    const { service, aborts } = makeService()
    const created = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(await Effect.runPromise(service.closeSession({ sessionId: created.sessionId }))).toEqual({})
    const missing = await Effect.runPromise(
      service
        .setSessionConfigOption({ sessionId: created.sessionId, configId: "effort", value: "high" })
        .pipe(Effect.mapError(ACPNextError.toRequestError), Effect.flip),
    )
    expect(missing.code).toBe(-32602)
    expect(aborts).toEqual([created.sessionId])
    expect(await Effect.runPromise(service.closeSession({ sessionId: "missing" }))).toEqual({})
  })

  it("does not fail close when backing abort fails", async () => {
    const sessionService = ManagedRuntime.make(ACPNextSession.defaultLayer).runSync(
      ACPNextSession.Service.use((service) => Effect.succeed(service)),
    )
    const { service } = makeService()
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        abort: () => Promise.reject(new Error("nope")),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const closing = ACPNextService.make({ sdk, session: sessionService })
    await Effect.runPromise(sessionService.create({ id: "ses_close", cwd: "/workspace" }))

    expect(await Effect.runPromise(closing.closeSession({ sessionId: "ses_close" }))).toEqual({})
    expect(await Effect.runPromise(service.closeSession({ sessionId: "missing" }))).toEqual({})
  })

  it("forks a session, loads fork state, and returns config options", async () => {
    const { service, forks } = makeService([
      {
        info: {
          role: "assistant",
          providerID: "test",
          modelID: "second-model",
          variant: "medium",
          mode: "plan",
        },
        parts: [],
      },
    ])
    const forked = await Effect.runPromise(
      service.forkSession({ cwd: "/workspace", sessionId: "ses_parent", mcpServers: [] }),
    )
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({ sessionId: forked.sessionId, configId: "effort", value: "low" }),
    )

    expect(forked.sessionId).toBe("fork_ses_parent")
    expect(select(forked, "model")?.currentValue).toBe("test/second-model")
    expect(select(forked, "effort")?.currentValue).toBe("medium")
    expect(select(updated, "effort")?.currentValue).toBe("low")
    expect(forks).toEqual(["ses_parent"])
  })

  it("restores model variant and mode from the latest user message", async () => {
    const { service } = makeService([
      {
        info: {
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "default" },
          agent: "build",
        },
        parts: [],
      },
      {
        info: {
          role: "user",
          model: { providerID: "test", modelID: "test-model", variant: "high" },
          agent: "plan",
        },
        parts: [],
      },
    ])
    const result = await Effect.runPromise(
      service.loadSession({ cwd: "/workspace", sessionId: "ses_loaded", mcpServers: [] }),
    )

    expect(result.configOptions?.find((option) => option.id === "effort")?.currentValue).toBe("high")
    expect(result.configOptions?.find((option) => option.id === "mode")?.currentValue).toBe("plan")
  })

  it("maps provider auth failures to auth-required request errors", async () => {
    const service = ACPNextService.make({
      sdk: {
        config: {
          providers: () => Promise.reject({ name: "ProviderAuthError", data: { providerID: "test" } }),
          get: () => Promise.resolve({ data: {} }),
        },
        app: {
          agents: () => Promise.resolve({ data: [] }),
          skills: () => Promise.resolve({ data: [] }),
        },
        command: {
          list: () => Promise.resolve({ data: [] }),
        },
      } as unknown as OpencodeClient,
    })
    const error = await Effect.runPromise(
      service
        .newSession({ cwd: "/workspace", mcpServers: [] })
        .pipe(Effect.mapError(ACPNextError.toRequestError), Effect.flip),
    )

    expect(error.code).toBe(-32000)
  })

  it("does not cache failed directory snapshots", async () => {
    let providersCalls = 0
    const sdk = {
      config: {
        providers: () => {
          providersCalls++
          if (providersCalls === 1) {
            return Promise.reject({ name: "ProviderAuthError", data: { providerID: "test" } })
          }
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_retry" } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPNextService.make({ sdk })

    const first = await Effect.runPromise(
      service
        .newSession({ cwd: "/workspace", mcpServers: [] })
        .pipe(Effect.mapError(ACPNextError.toRequestError), Effect.flip),
    )
    const second = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(first.code).toBe(-32000)
    expect(second.sessionId).toBe("ses_retry")
    expect(providersCalls).toBe(2)
  })

  it("registers same-name MCP servers again for different sessions or configs", async () => {
    const adds: unknown[] = []
    let nextSession = 0
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: () => {
          nextSession++
          return Promise.resolve({ data: { id: `ses_${nextSession}` } })
        },
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: (input: unknown) => {
          adds.push(input)
          return Promise.resolve({ data: {} })
        },
      },
    } as unknown as OpencodeClient
    const service = ACPNextService.make({ sdk })

    await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [{ name: "tools", command: "node", args: ["one.js"], env: [] }],
      }),
    )
    await Effect.runPromise(
      service.newSession({
        cwd: "/workspace",
        mcpServers: [{ name: "tools", command: "node", args: ["two.js"], env: [] }],
      }),
    )

    expect(adds).toHaveLength(2)
    expect(JSON.stringify(adds[0])).toContain("one.js")
    expect(JSON.stringify(adds[1])).toContain("two.js")
  })

  it("uses the configured model as the new session default", async () => {
    const sdk = {
      config: {
        providers: () => Promise.resolve({ data: { providers: [provider], default: { test: modelID } } }),
        get: () => Promise.resolve({ data: { model: "test/configured-model" } }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => Promise.resolve({ data: [] }),
      },
      session: {
        create: (input: { model?: { id?: string } }) => Promise.resolve({ data: { id: input.model?.id } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPNextService.make({ sdk })

    const result = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(result.sessionId).toBe("configured-model")
    expect(result.configOptions?.find((option) => option.id === "model")?.currentValue).toBe("test/configured-model")
  })

  it("switches model and returns updated model and effort options", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "model",
        value: "test/second-model",
      }),
    )

    expect(select(updated, "model")?.currentValue).toBe("test/second-model")
    expect(select(updated, "effort")?.currentValue).toBe("low")
    expect(flattenSelectOptions(select(updated, "effort")).map((option) => option.value)).toEqual(["low", "medium"])
  })

  it("switches effort and returns the updated effort current value", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "effort",
        value: "high",
      }),
    )

    expect(select(updated, "effort")?.currentValue).toBe("high")
  })

  it("switches mode and returns the updated mode current value", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))
    const updated = await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "mode",
        value: "plan",
      }),
    )

    expect(select(updated, "mode")?.currentValue).toBe("plan")
  })

  it("maps invalid model effort mode and config id to invalid params", async () => {
    const { service } = makeService()
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    const results = await Promise.all(
      [
        { configId: "model", value: "test/missing-model" },
        { configId: "effort", value: "max" },
        { configId: "mode", value: "missing-mode" },
        { configId: "missing", value: "value" },
      ].map((input) =>
        Effect.runPromise(
          service
            .setSessionConfigOption({ sessionId: session.sessionId, ...input })
            .pipe(Effect.mapError(ACPNextError.toRequestError), Effect.flip),
        ),
      ),
    )
    expect(results.map((error) => error.code)).toEqual([-32602, -32602, -32602, -32602])
  })

  it("does not reload providers or commands when switching effort from a warm snapshot", async () => {
    let providersCalls = 0
    let commandCalls = 0
    const sdk = {
      config: {
        providers: () => {
          providersCalls++
          return Promise.resolve({ data: { providers: [provider], default: { test: modelID } } })
        },
        get: () => Promise.resolve({ data: {} }),
      },
      app: {
        agents: () => Promise.resolve({ data: [{ name: "build", mode: "primary", permission: [], options: {} }] }),
        skills: () => Promise.resolve({ data: [] }),
      },
      command: {
        list: () => {
          commandCalls++
          return Promise.resolve({ data: [] })
        },
      },
      session: {
        create: () => Promise.resolve({ data: { id: "ses_fast" } }),
        list: () => Promise.resolve({ data: [] }),
      },
      mcp: {
        add: () => Promise.resolve({ data: {} }),
      },
    } as unknown as OpencodeClient
    const service = ACPNextService.make({ sdk })
    const session = await Effect.runPromise(service.newSession({ cwd: "/workspace", mcpServers: [] }))

    expect(providersCalls).toBe(1)
    expect(commandCalls).toBe(1)

    await Effect.runPromise(
      service.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: "effort",
        value: "high",
      }),
    )

    expect(providersCalls).toBe(1)
    expect(commandCalls).toBe(1)
  })
})

function categories(result: NewSessionResponse | LoadSessionResponse) {
  return result.configOptions?.map((option) => option.category) ?? []
}

function select(
  result: SetSessionConfigOptionResponse | ResumeSessionResponse | NewSessionResponse | ForkSessionResponse,
  id: string,
) {
  return result.configOptions?.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.id === id && option.type === "select",
  )
}

function flattenSelectOptions(option: Extract<SessionConfigOption, { type: "select" }> | undefined) {
  return option?.options.flatMap((item): SessionConfigSelectOption[] => ("value" in item ? [item] : item.options)) ?? []
}
