import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient } from "@opencode-ai/sdk/v2"
import { runInteractiveMode } from "@/cli/cmd/run/runtime"
import type { FooterApi, FooterEvent, RunProvider } from "@/cli/cmd/run/types"

const provider: RunProvider = {
  id: "openai",
  name: "OpenAI",
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      name: "Little Frank",
      capabilities: {
        tools: true,
        input: ["text"],
        output: ["text"],
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      variants: {},
    },
  },
}

const transportProviders: RunProvider[][] = []

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function footer(events: FooterEvent[] = []): FooterApi {
  let closed = false
  const closes = new Set<() => void>()

  const notify = () => {
    for (const fn of closes) fn()
  }

  return {
    get isClosed() {
      return closed
    },
    onPrompt: () => () => {},
    onQueuedRemove: () => () => {},
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }

      closes.add(fn)
      return () => {
        closes.delete(fn)
      }
    },
    event(value) {
      events.push(value)
    },
    append() {},
    idle() {
      return Promise.resolve()
    },
    close() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
    destroy() {
      if (closed) {
        return
      }

      closed = true
      notify()
    },
  }
}

afterEach(() => {
  mock.restore()
  transportProviders.length = 0
})

describe("run interactive runtime", () => {
  test("waits for provider metadata before eager replay transport bootstrap", async () => {
    const providersStarted = defer<void>()
    const providers = defer<void>()
    const lifecycleModels: unknown[] = []

    const sdk = new OpencodeClient()
    const legacyProviders = spyOn(sdk.config, "providers").mockRejectedValue(new Error("legacy providers should stay unused"))
    const legacyAgents = spyOn(sdk.app, "agents").mockRejectedValue(new Error("legacy agents should stay unused"))
    const legacyCommands = spyOn(sdk.command, "list").mockRejectedValue(new Error("legacy commands should stay unused"))
    spyOn(sdk.v2.provider, "list").mockImplementation(async () => {
      providersStarted.resolve()
      await providers.promise
      return ok({
        location: {
          directory: "/tmp",
        },
        data: [
          {
            id: "openai",
            name: "OpenAI",
            api: {
              type: "native",
              settings: {},
            },
            request: {
              headers: {},
              body: {},
            },
          },
        ],
      }) as never
    })
    spyOn(sdk.v2.model, "list").mockImplementation(() =>
      ok({
        location: {
          directory: "/tmp",
        },
        data: [
          {
            id: "gpt-5",
            providerID: "openai",
            name: "Little Frank",
            api: {
              id: "openai",
              type: "native",
              settings: {},
            },
            capabilities: {
              tools: true,
              input: ["text"],
              output: ["text"],
            },
            request: {
              headers: {},
              body: {},
            },
            variants: [],
            time: {
              released: 1,
            },
            cost: [
              {
                input: 0,
                output: 0,
                cache: {
                  read: 0,
                  write: 0,
                },
              },
            ],
            status: "active",
            enabled: true,
            limit: {
              context: 128000,
              output: 8192,
            },
          },
        ],
      }) as never,
    )
    spyOn(sdk.v2.session, "messages").mockImplementation(() =>
      ok({
        data: [
          {
            id: "msg-user-1",
            type: "user",
            text: "hello",
            time: {
              created: 1,
            },
          },
        ],
        cursor: {},
      }),
    )
    spyOn(sdk.v2.session, "get").mockImplementation(() =>
      ok({
        data: {
          id: "ses-1",
          projectID: "pro-1",
          title: "Session",
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
          time: {
            created: 1,
            updated: 1,
          },
          location: {
            directory: "/tmp",
          },
          model: {
            providerID: "openai",
            id: "gpt-5",
          },
        },
      }),
    )
    spyOn(sdk.v2.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.v2.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.v2.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.v2.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)

    const task = runInteractiveMode(
      {
        sdk,
        directory: "/tmp",
        sessionID: "ses-1",
        sessionTitle: "Session",
        resume: true,
        replay: true,
        replayLimit: 100,
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: true,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycleModels.push(input.model)
          return {
            footer: footer(),
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input: { providers?: () => RunProvider[]; footer: FooterApi }) => {
            transportProviders.push(input.providers?.() ?? [])
            setTimeout(() => {
              input.footer.close()
            }, 0)
            return {
              runPromptTurn: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    await providersStarted.promise

    expect(transportProviders).toEqual([])

    providers.resolve()

    await task

    expect(lifecycleModels).toEqual([{ providerID: "openai", modelID: "gpt-5" }])
    expect(transportProviders).toEqual([[provider]])
    expect(legacyProviders).not.toHaveBeenCalled()
    expect(legacyAgents).not.toHaveBeenCalled()
    expect(legacyCommands).not.toHaveBeenCalled()
  })

  test("defers catalog-selected model resolution until after first paint", async () => {
    const sdk = new OpencodeClient()
    const defaultStarted = defer<void>()
    const releaseDefault = defer<void>()
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const modelShown = defer<void>()
    let defaultRequested = false
    const events: FooterEvent[] = []
    const api = footer(events)
    api.idle = () => painted.promise
    const event = api.event
    api.event = (value) => {
      event(value)
      if (value.type !== "model") return
      modelShown.resolve()
      api.close()
    }

    spyOn(sdk.v2.model, "default").mockImplementation(async () => {
      defaultRequested = true
      defaultStarted.resolve()
      await releaseDefault.promise
      return ok({
        location: { directory: "/tmp" },
        data: { id: "gpt-5", providerID: "openai" },
      }) as never
    })
    spyOn(sdk.v2.provider, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    spyOn(sdk.v2.model, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    spyOn(sdk.v2.agent, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    spyOn(sdk.v2.reference, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    spyOn(sdk.v2.command, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    spyOn(sdk.v2.skill, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )

    const task = runInteractiveMode(
      {
        sdk,
        directory: "/tmp",
        sessionID: "ses-fresh",
        resume: false,
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async (input) => {
          expect(input.model).toBeUndefined()
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async () => ({
            runPromptTurn: async () => {},
            interruptActiveTurn: async () => {},
            selectSubagent: () => {},
            replayOnResize: async () => false,
            close: async () => {},
          }),
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    await lifecycleStarted.promise
    expect(defaultRequested).toBe(false)
    painted.resolve()
    await defaultStarted.promise
    releaseDefault.resolve()
    await modelShown.promise
    await task

    expect(events.find((event) => event.type === "model")).toEqual({
      type: "model",
      model: "gpt-5 · openai",
      selection: { providerID: "openai", modelID: "gpt-5" },
    })
  })

  test("does not start deferred work after the footer closes", async () => {
    const sdk = new OpencodeClient()
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    const defaultModel = spyOn(sdk.v2.model, "default")

    const task = runInteractiveMode(
      {
        sdk,
        directory: "/tmp",
        sessionID: "ses-closed",
        resume: false,
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async () => {
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
      },
    )

    await lifecycleStarted.promise
    api.close()
    painted.resolve()
    await task

    expect(defaultModel).not.toHaveBeenCalled()
  })

  test("retains last-known-good state across failed coalesced refreshes and retries later", async () => {
    const sdk = new OpencodeClient()
    const refreshGate = defer<void>()
    let providerCalls = 0
    let modelCalls = 0
    let agentCalls = 0
    let referenceCalls = 0
    const events: FooterEvent[] = []
    const api = footer(events)
    spyOn(sdk.v2.provider, "list").mockImplementation(async () => {
      providerCalls++
      if (providerCalls === 2) {
        await refreshGate.promise
        throw new Error("provider refresh failed")
      }
      return ok({
        location: { directory: "/tmp" },
        data: [
          {
            id: "openai",
            name: providerCalls >= 3 ? "OpenAI refreshed" : "OpenAI",
            api: { type: "native", settings: {} },
            request: { headers: {}, body: {} },
          },
        ],
      }) as never
    })
    spyOn(sdk.v2.model, "list").mockImplementation(() => {
      modelCalls++
      return ok({
        location: { directory: "/tmp" },
        data: [
          {
            id: "gpt-5",
            providerID: "openai",
            name: "Little Frank",
            api: { id: "openai", type: "native", settings: {} },
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            request: { headers: {}, body: {} },
            variants:
              modelCalls >= 4
                ? []
                : [{ id: modelCalls >= 3 ? "high" : "low", settings: {}, headers: {}, body: {} }],
            time: { released: 1 },
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            status: "active",
            enabled: true,
            limit: { context: modelCalls >= 3 ? 256000 : 128000, output: 8192 },
          },
        ],
      }) as never
    })
    spyOn(sdk.v2.agent, "list").mockImplementation(async () => {
      agentCalls++
      if (agentCalls === 2) throw new Error("agent refresh failed")
      return ok({
        location: { directory: "/tmp" },
        data: [{ id: "build", description: agentCalls >= 3 ? "Refreshed agent" : "Agent", mode: "primary" }],
      }) as never
    })
    spyOn(sdk.v2.reference, "list").mockImplementation(() => {
      referenceCalls++
      return ok({
        location: { directory: "/tmp" },
        data: [
          { name: "effect", path: "/effect", description: referenceCalls >= 3 ? "Refreshed reference" : "Reference" },
        ],
      }) as never
    })
    spyOn(sdk.v2.command, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [{ name: "check", description: "Check" }] }) as never,
    )
    spyOn(sdk.v2.skill, "list").mockImplementation(() =>
      ok({ location: { directory: "/tmp" }, data: [] }) as never,
    )
    let finalProviders: RunProvider[] = []
    let finalLimits: Record<string, number> = {}
    let retainedProviders: RunProvider[] = []
    let retainedLimits: Record<string, number> = {}
    let retainedCatalog: FooterEvent | undefined
    let selectedDefault: unknown
    let selectDefault: (() => unknown) | undefined
    let selectVariant: ((variant: string | undefined) => unknown) | undefined
    let defaultRefreshVariants: FooterEvent | undefined

    await runInteractiveMode(
      {
        sdk,
        directory: "/tmp",
        sessionID: "ses-1",
        sessionTitle: "Session",
        resume: false,
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "low",
        files: [],
        thinking: false,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async (input) => {
          selectDefault = () => input.onVariantSelect?.(undefined)
          selectVariant = (variant) => input.onVariantSelect?.(variant)
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            while (
              !events.some(
                (event) => event.type === "variants" && event.variants.includes("low") && event.current === "low",
              )
            )
              await Bun.sleep(0)
            selectedDefault = await Promise.resolve(selectDefault?.())
            input.onCatalogRefresh?.()
            input.onCatalogRefresh?.()
            input.onCatalogRefresh?.()
            while (providerCalls < 2) await Bun.sleep(0)
            refreshGate.resolve()
            await new Promise((resolve) => setTimeout(resolve, 0))
            retainedProviders = input.providers?.() ?? []
            retainedLimits = input.limits()
            retainedCatalog = events.filter((event) => event.type === "catalog").at(-1)
            input.onCatalogRefresh?.()
            input.onCatalogRefresh?.()
            while (providerCalls < 3 || modelCalls < 3 || agentCalls < 3) await Bun.sleep(0)
            await new Promise((resolve) => setTimeout(resolve, 0))
            defaultRefreshVariants = events.filter((event) => event.type === "variants").at(-1)
            await Promise.resolve(selectVariant?.("high"))
            input.onCatalogRefresh?.()
            while (providerCalls < 4 || modelCalls < 4) await Bun.sleep(0)
            await new Promise((resolve) => setTimeout(resolve, 0))
            finalProviders = input.providers?.() ?? []
            finalLimits = input.limits()
            setTimeout(() => input.footer.close(), 0)
            return {
              runPromptTurn: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )

    expect(providerCalls).toBe(4)
    expect(modelCalls).toBe(4)
    expect(retainedProviders[0]?.name).toBe("OpenAI")
    expect(retainedProviders[0]?.models["gpt-5"]?.variants).toEqual({ low: {} })
    expect(retainedLimits["openai/gpt-5"]).toBe(128000)
    expect(retainedCatalog).toMatchObject({
      agents: [{ name: "build", description: "Agent" }],
      references: [{ name: "effect", description: "Reference" }],
    })
    expect(selectedDefault).toMatchObject({ variant: undefined })
    expect(defaultRefreshVariants).toMatchObject({ variants: ["high"], current: undefined })
    expect(finalProviders[0]?.name).toBe("OpenAI refreshed")
    expect(finalProviders[0]?.models["gpt-5"]?.variants).toEqual({})
    expect(finalLimits["openai/gpt-5"]).toBe(256000)
    expect(events.filter((event) => event.type === "variants").at(-1)).toMatchObject({
      variants: [],
      current: undefined,
    })
    expect(events.filter((event) => event.type === "catalog").at(-1)).toMatchObject({
      agents: [{ name: "build", description: "Refreshed agent" }],
      references: [{ name: "effect", description: "Refreshed reference" }],
      commands: [{ name: "check", description: "Check" }],
    })
  })
})
