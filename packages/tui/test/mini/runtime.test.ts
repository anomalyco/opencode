import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { AgentListOutput, ModelListOutput, ProviderListOutput } from "@opencode/client/promise"
import { runInteractiveDeferredMode } from "../../src/mini/runtime"
import type { LifecycleInput } from "../../src/mini/runtime.lifecycle"
import type { FooterEvent, MiniHost, StreamCommit } from "../../src/mini/types"
import { catalogAgent, catalogModel, catalogProvider, stubCatalogLists } from "./fixture/catalog"
import { createFooterApiFixture } from "./fixture/footer-api"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function ok<T>(data: T) {
  return Promise.resolve(data)
}

function host(): MiniHost {
  return {
    version: "local",
    terminal: { stdin: process.stdin },
    platform: "linux",
    stdout: { write() {} },
    files: { readText: async () => "" },
    editor: { open: async () => undefined },
    paths: { home: "/home/test" },
    signals: {
      sigint: { subscribe: () => () => {} },
      sigusr2: { subscribe: () => () => {} },
    },
    startup: { showTiming: false, now: () => 0 },
    diagnostics: {},
    preferences: {
      resolveVariant: async () => undefined,
      saveVariant: async () => {},
    },
  }
}

function footer(events: FooterEvent[] = []) {
  return createFooterApiFixture({ events }).api
}

afterEach(() => {
  mock.restore()
})

describe("run interactive runtime", () => {
  test("resolves the default model reactively without blocking catalog startup", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const events: FooterEvent[] = []
    const ui = createFooterApiFixture({ events })
    const api = ui.api
    const selected = defer<Awaited<ReturnType<typeof sdk.model.default>>>()
    const catalogLoaded = defer<void>()
    const defaultModelReloaded = defer<void>()
    const modelShown = defer<void>()
    const turnStarted = defer<void>()
    const model = catalogModel({
      id: "resolved",
      providerID: "test",
      name: "Resolved Model",
      variants: ["low", "high"],
    })
    let lifecycle!: LifecycleInput
    let turnAgent: string | undefined
    let turnModel: { providerID: string; modelID: string } | undefined
    let refreshCatalog: (() => Promise<unknown>) | undefined
    stubCatalogLists(sdk, {
      providers: [catalogProvider("test", "Test Provider")],
      models: [model],
    })
    let defaultModelCalls = 0
    const defaultModel = spyOn(sdk.model, "default").mockImplementation(() => {
      defaultModelCalls++
      if (defaultModelCalls === 2) defaultModelReloaded.resolve()
      return selected.promise
    })
    const emit = api.event.bind(api)
    api.event = (event) => {
      emit(event)
      if (event.type === "model") modelShown.resolve()
    }

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses_root",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: undefined,
          variant: undefined,
          resume: false,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            refreshCatalog = () => Promise.resolve(input.onCatalogRefresh?.())
            await refreshCatalog()
            catalogLoaded.resolve()
            return {
              runPromptTurn: async (input) => {
                turnAgent = input.agent
                turnModel = input.model
                turnStarted.resolve()
                api.close()
              },
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => String(error),
        }),
      },
    )

    await catalogLoaded.promise
    expect(events.some((event) => event.type === "model")).toBe(false)
    await refreshCatalog?.()
    expect(defaultModel).toHaveBeenCalledTimes(1)
    selected.resolve({
      location: { directory: "/tmp" },
      data: model,
    })
    await defaultModelReloaded.promise
    await modelShown.promise
    expect(events).toContainEqual({
      type: "model",
      model: "Resolved Model · Test Provider",
      selection: { providerID: "test", modelID: "resolved" },
    })
    expect(lifecycle.onCycleVariant?.()).toMatchObject({ status: "variant low", variant: "low" })
    lifecycle.onAgentSelect?.("review")
    await ui.promptReady
    expect(ui.submit("hello")).toBe(true)
    await turnStarted.promise
    expect(turnAgent).toBe("review")
    expect(turnModel).toEqual({ providerID: "test", modelID: "resolved" })
    await task
  })

  test("routes form responses to their owners with global location and local settlement", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const api = footer()
    const streamStarted = defer<void>()
    let lifecycle!: LifecycleInput
    const settled: Array<{ sessionID: string; formID: string }> = []
    stubCatalogLists(sdk)
    const reply = spyOn(sdk.session.form, "reply").mockImplementation(() => ok(undefined))

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses_root",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: { providerID: "test", modelID: "model" },
          variant: undefined,
          resume: false,
        }),
        agent: "build",
        model: { providerID: "test", modelID: "model" },
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async () => {
            streamStarted.resolve()
            return {
              runPromptTurn: async () => {},
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              settleForm: (sessionID: string, formID: string) => settled.push({ sessionID, formID }),
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
        }),
      },
    )
    await streamStarted.promise

    await lifecycle.onFormReply({
      sessionID: "global",
      formID: "frm_global",
      answer: { value: "yes" },
      location: { directory: "/remote work" },
    })
    expect(reply).toHaveBeenCalledWith(
      {
        sessionID: "global",
        formID: "frm_global",
        answer: { value: "yes" },
        location: { directory: "/remote work" },
      },
      {
        headers: {
          "x-opencode-directory": "%2Fremote%20work",
        },
      },
    )
    expect(settled).toEqual([{ sessionID: "global", formID: "frm_global" }])

    reply.mockImplementationOnce(() => Promise.reject({ _tag: "FormInvalidAnswerError", message: "Invalid answer" }))
    await expect(
      lifecycle.onFormReply({ sessionID: "ses_child", formID: "frm_invalid", answer: { value: 3 } }),
    ).rejects.toEqual({ _tag: "FormInvalidAnswerError", message: "Invalid answer" })
    expect(settled.some((item) => item.formID === "frm_invalid")).toBe(false)

    api.close()
    await task
  })

  test("resolves the deferred session only after first paint", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    let resolved = 0
    api.idle = () => painted.promise
    stubCatalogLists(sdk)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => {
          resolved++
          api.close()
          return {
            sessionID: "ses-deferred",
            sessionTitle: "Deferred",
            location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-5" },
            variant: undefined,
            resume: false,
          }
        },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => {
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
      },
    )

    await lifecycleStarted.promise
    expect(resolved).toBe(0)
    painted.resolve()
    await task
    expect(resolved).toBe(1)
  })

  test("restores deferred session history and model after first paint", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const events: FooterEvent[] = []
    const titles: Array<string | undefined> = []
    const api = footer(events)
    api.idle = () => painted.promise
    const event = api.event
    api.event = (value) => {
      event(value)
      if (value.type === "model") api.close()
    }
    spyOn(sdk.session, "get").mockImplementation(
      () =>
        ok({
          id: "ses-resume",
          projectID: "pro-1",
          title: "Resume",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
          location: { directory: "/tmp" },
          model: { providerID: "openai", id: "gpt-5", variant: "high" },
        }) as never,
    )
    spyOn(sdk.message, "list").mockImplementation(
      () =>
        ok({
          data: [{ id: "msg-user", type: "user", text: "previous prompt", time: { created: 1 } }],
          cursor: {},
        }) as never,
    )
    stubCatalogLists(sdk, {
      providers: [catalogProvider("openai", "OpenAI")],
      models: [
        catalogModel({
          id: "gpt-5",
          providerID: "openai",
          name: "Little Frank",
          variants: ["high"],
        }),
      ],
    })

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume",
          sessionTitle: "Resume",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5" },
          variant: "high",
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => {
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: (title) => titles.push(title),
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
      },
    )

    await lifecycleStarted.promise
    expect(sdk.session.get).not.toHaveBeenCalled()
    painted.resolve()
    await task

    expect(events).toContainEqual({
      type: "history",
      history: [{ text: "previous prompt", parts: [] }],
    })
    expect(events).toContainEqual({ type: "agent", agent: "review" })
    expect(titles).toEqual(["Resume"])
    expect(events).toContainEqual({
      type: "model",
      model: "Little Frank · OpenAI · high",
      selection: { providerID: "openai", modelID: "gpt-5" },
    })
  })

  test("aborts deferred resume history on close and uses the cached exit title", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const painted = defer<void>()
    const readsStarted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    let reads = 0
    let aborted = 0
    let closedTitle: string | undefined
    const pending = (signal: AbortSignal | undefined) =>
      new Promise<never>((_resolve, reject) => {
        reads++
        if (reads === 2) readsStarted.resolve()
        signal?.addEventListener(
          "abort",
          () => {
            aborted++
            reject(new Error("resume history aborted"))
          },
          { once: true },
        )
      })
    const messages = spyOn(sdk.message, "list").mockImplementation(
      (_request, options) => pending(options?.signal) as never,
    )
    const session = spyOn(sdk.session, "get").mockImplementation(
      (_request, options) => pending(options?.signal) as never,
    )
    stubCatalogLists(sdk)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume-abort",
          sessionTitle: "Cached title",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: "build",
          model: undefined,
          variant: undefined,
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: api,
          onResize: () => () => {},
          refreshTheme: () => {},
          setTitle: () => {},
          resetForReplay: () => Promise.resolve(),
          close: async (input) => {
            closedTitle = input.sessionTitle
          },
        }),
      },
    )

    painted.resolve()
    await readsStarted.promise
    api.close()
    await task

    expect(aborted).toBe(2)
    expect(messages).toHaveBeenCalledWith(
      { sessionID: "ses-resume-abort", limit: 200, order: "desc" },
      { signal: expect.any(AbortSignal) },
    )
    expect(session).toHaveBeenCalledTimes(1)
    expect(session).toHaveBeenCalledWith({ sessionID: "ses-resume-abort" }, { signal: expect.any(AbortSignal) })
    expect(closedTitle).toBe("Cached title")
  })

  test("adopts deferred target placement and supplied TUI config", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    let targets = 0
    let getDirectory: (() => string) | undefined
    let findFiles: ((query: string) => Promise<string[]>) | undefined
    let transportLocation: unknown
    let runtimeConfig: LifecycleInput["tuiConfig"] | undefined
    const tuiConfig = createTuiResolvedConfig({ keybinds: { "variant.cycle": "ctrl+g" } })
    const catalogs = stubCatalogLists(sdk, {
      location: { directory: "/session", workspaceID: "work-1" },
    })
    const fileFind = spyOn(sdk.file, "find").mockResolvedValue({
      location: {
        directory: "/session",
        workspaceID: "work-1",
        project: { id: "pro-1", directory: "/session", canonical: "/session" },
      },
      data: [{ path: "src/index.ts", type: "file" }],
    } as never)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/launch",
        target: async () => {
          targets++
          return {
            sessionID: "ses-target",
            location: {
              directory: "/session",
              workspaceID: "work-1",
              project: { id: "location-project", directory: "/session", canonical: "/session" },
            },
            agent: "review",
            model: { providerID: "openai", modelID: "gpt-5" },
            variant: "high",
            resume: false,
          }
        },
        agent: undefined,
        model: undefined,
        variant: undefined,
        files: [],
        tuiConfig,
      },
      {
        createRuntimeLifecycle: async (input) => {
          getDirectory = input.getDirectory
          findFiles = input.findFiles
          runtimeConfig = input.tuiConfig
          lifecycleStarted.resolve()
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (input) => {
            transportLocation = input.location
            await findFiles?.("index")
            setTimeout(() => input.footer.close(), 0)
            return {
              runPromptTurn: async () => {},
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => String(error),
        }),
      },
    )

    await lifecycleStarted.promise
    expect(targets).toBe(0)
    expect(getDirectory?.()).toBe("/launch")
    painted.resolve()
    await task

    const query = { location: { directory: "/session" } }
    expect(getDirectory?.()).toBe("/session")
    if (!runtimeConfig) throw new Error("runtime lifecycle did not receive TUI config")
    expect(await runtimeConfig).toBe(tuiConfig)
    expect(transportLocation).toMatchObject({ directory: "/session", workspaceID: "work-1" })
    expect(catalogs.provider).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.model).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.agent).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.reference).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(catalogs.command).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(fileFind).toHaveBeenCalledWith({ query: "index", type: "file", ...query })
  })
})

describe("agent model in the footer", () => {
  const agentModel = catalogModel({
    id: "agent-model",
    providerID: "mock",
    name: "Agent Model From Frontmatter",
    variants: ["low", "high"],
  })
  const freeModel = catalogModel({
    id: "tidepool-alpha-free",
    providerID: "opencode",
    name: "Tidepool Alpha Free",
  })

  function modelEvent(events: FooterEvent[], selection: { providerID: string; modelID: string }) {
    return events.find(
      (event) =>
        event.type === "model" &&
        event.selection.providerID === selection.providerID &&
        event.selection.modelID === selection.modelID,
    )
  }

  function lastModelEvent(events: FooterEvent[]) {
    return [...events].reverse().find((event) => event.type === "model")
  }

  // Drives the runtime with a stubbed catalog + transport. The server default
  // is held behind a deferred so each test decides when it becomes available.
  function startAgentCase(input: {
    agents: AgentListOutput["data"]
    providers?: ProviderListOutput["data"]
    models?: ModelListOutput["data"]
    defaultModel?: ModelListOutput["data"][number]
    agent: string
    model?: { providerID: string; modelID: string }
    variant?: string
    resume?: boolean
  }) {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const events: FooterEvent[] = []
    const commits: StreamCommit[] = []
    const ui = createFooterApiFixture({ events, commits })
    const api = ui.api
    const selected = defer<Awaited<ReturnType<typeof sdk.model.default>>>()
    const catalogLoaded = defer<void>()
    const turnStarted = defer<void>()
    let lifecycle!: LifecycleInput
    let turnAgent: string | undefined
    let turnModel: { providerID: string; modelID: string } | undefined
    let turnVariant: string | undefined
    let refreshCatalog: (() => Promise<unknown>) | undefined
    const waiters: Array<{
      selection: { providerID: string; modelID: string }
      resolve: () => void
    }> = []
    spyOn(sdk.model, "default").mockImplementation(() => selected.promise)
    stubCatalogLists(sdk, {
      providers: input.providers ?? [catalogProvider("mock", "Mock"), catalogProvider("opencode", "OpenCode")],
      models: input.models ?? [agentModel, freeModel],
      agents: input.agents,
    })
    if (input.resume) {
      spyOn(sdk.session, "get").mockImplementation(
        () =>
          ok({
            id: "ses-resume",
            projectID: "pro-1",
            title: "Resume",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            location: { directory: "/tmp" },
          }) as never,
      )
      spyOn(sdk.message, "list").mockImplementation(
        () =>
          ok({
            data: [{ id: "msg-user", type: "user", text: "previous prompt", time: { created: 1 } }],
            cursor: {},
          }) as never,
      )
    }
    const emit = api.event.bind(api)
    api.event = (event) => {
      emit(event)
      if (event.type !== "model") return
      for (const waiter of [...waiters]) {
        if (
          event.selection.providerID === waiter.selection.providerID &&
          event.selection.modelID === waiter.selection.modelID
        ) {
          waiter.resolve()
          waiters.splice(waiters.indexOf(waiter), 1)
        }
      }
    }

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-agent-model",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp", canonical: "/tmp" } },
          agent: input.agent,
          model: input.model,
          variant: input.variant,
          resume: input.resume ?? false,
        }),
        agent: input.agent,
        model: input.model,
        variant: input.variant,
        files: [],
      },
      {
        createRuntimeLifecycle: async (next) => {
          lifecycle = next
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            setTitle: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async (transport) => {
            refreshCatalog = () => Promise.resolve(transport.onCatalogRefresh?.())
            await refreshCatalog()
            catalogLoaded.resolve()
            return {
              runPromptTurn: async (turn) => {
                turnAgent = turn.agent
                turnModel = turn.model
                turnVariant = turn.variant
                turnStarted.resolve()
                api.close()
              },
              admitPromptTurn: async () => {},
              waitForIdle: async () => {},
              interruptActiveTurn: async () => {},
              selectSubagent: () => {},
              replayOnResize: async () => false,
              close: async () => {},
            }
          },
          formatUnknownError: (error: unknown) => String(error),
        }),
      },
    )

    return {
      sdk,
      events,
      commits,
      ui,
      api,
      task,
      get lifecycle() {
        return lifecycle
      },
      get turn() {
        return { agent: turnAgent, model: turnModel, variant: turnVariant }
      },
      async waitForCatalog() {
        await catalogLoaded.promise
        await refreshCatalog?.()
      },
      resolveDefault(model = input.defaultModel ?? freeModel) {
        selected.resolve({ location: { directory: "/tmp" }, data: model })
      },
      waitForModel(selection: { providerID: string; modelID: string }) {
        if (modelEvent(events, selection)) return Promise.resolve()
        return Promise.race([
          new Promise<void>((resolve) => {
            waiters.push({ selection, resolve })
          }),
          Bun.sleep(5000).then(() => {
            throw new Error(
              `footer never showed ${selection.providerID}/${selection.modelID}; got ${JSON.stringify(events.filter((event) => event.type === "model"))}`,
            )
          }),
        ])
      },
      async submit(text = "hello") {
        await ui.promptReady
        expect(ui.submit(text)).toBe(true)
        await turnStarted.promise
      },
    }
  }

  test("shows the agent model for a fresh session, not the server default", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } })],
      agent: "example",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    expect(modelEvent(run.events, { providerID: "mock", modelID: "agent-model" })).toMatchObject({
      model: "Agent Model From Frontmatter · Mock",
    })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "mock", modelID: "agent-model" },
    })
    await run.submit()
    expect(run.turn.agent).toBe("example")
    // The server resolves the agent model per step; mini must not pin a model.
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("shows the agent model for a resumed session with no stored model", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } })],
      agent: "example",
      resume: true,
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "mock", modelID: "agent-model" },
    })
    await run.submit()
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("prefers the agent model over a configured global model", async () => {
    const configured = catalogModel({ id: "gpt-5", providerID: "openai", name: "Configured Global" })
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } })],
      providers: [
        catalogProvider("mock", "Mock"),
        catalogProvider("openai", "OpenAI"),
        catalogProvider("opencode", "OpenCode"),
      ],
      models: [agentModel, configured, freeModel],
      defaultModel: configured,
      agent: "example",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "mock", modelID: "agent-model" },
    })
    await run.submit()
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("falls back to the server default when the agent has no model", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "plain" })],
      agent: "plain",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "opencode", modelID: "tidepool-alpha-free" })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "opencode", modelID: "tidepool-alpha-free" },
    })
    await run.submit()
    // No agent model and no explicit model: the turn carries no model either;
    // the server default applies server-side.
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("explicit --model wins over the agent model", async () => {
    const explicit = catalogModel({ id: "gpt-5", providerID: "openai", name: "Explicit Choice" })
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } })],
      providers: [catalogProvider("mock", "Mock"), catalogProvider("openai", "OpenAI")],
      models: [agentModel, explicit],
      agent: "example",
      model: { providerID: "openai", modelID: "gpt-5" },
    })

    await run.waitForCatalog()
    await run.waitForModel({ providerID: "openai", modelID: "gpt-5" })
    expect(modelEvent(run.events, { providerID: "mock", modelID: "agent-model" })).toBeUndefined()
    await run.submit()
    expect(run.turn.model).toEqual({ providerID: "openai", modelID: "gpt-5" })
    await run.task
  })

  test("updates the footer model when switching agents mid-session", async () => {
    const run = startAgentCase({
      agents: [
        catalogAgent({ id: "plain" }),
        catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } }),
      ],
      agent: "plain",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "opencode", modelID: "tidepool-alpha-free" })
    run.lifecycle.onAgentSelect?.("example")
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "mock", modelID: "agent-model" },
    })
    await run.submit()
    expect(run.turn.agent).toBe("example")
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("falls back to the server default with a warning when the agent model is unavailable", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "offline", id: "agent-model" } })],
      agent: "example",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "opencode", modelID: "tidepool-alpha-free" })
    expect(lastModelEvent(run.events)).toMatchObject({
      selection: { providerID: "opencode", modelID: "tidepool-alpha-free" },
    })
    expect(run.commits).toContainEqual(
      expect.objectContaining({
        kind: "system",
        text: expect.stringContaining(
          "Agent model offline/agent-model is unavailable or its provider is not connected.",
        ),
      }),
    )
    await run.submit()
    expect(run.turn.model).toBeUndefined()
    await run.task
  })

  test("keeps the agent model variant in the footer without sending it as the model", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model", variant: "high" } })],
      agent: "example",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    expect(modelEvent(run.events, { providerID: "mock", modelID: "agent-model" })).toMatchObject({
      model: "Agent Model From Frontmatter · Mock · high",
    })
    expect(run.events).toContainEqual({ type: "variants", variants: ["low", "high"], current: "high" })
    await run.submit()
    // The agent variant applies server-side; mini sends no model and no variant.
    expect(run.turn.model).toBeUndefined()
    expect(run.turn.variant).toBeUndefined()
    await run.task
  })

  test("never sends the server default when a variant is active with an agent model", async () => {
    const run = startAgentCase({
      agents: [catalogAgent({ id: "example", model: { providerID: "mock", id: "agent-model" } })],
      agent: "example",
      variant: "high",
    })

    await run.waitForCatalog()
    run.resolveDefault()
    await run.waitForModel({ providerID: "mock", modelID: "agent-model" })
    await run.submit()
    expect(run.turn.model).toEqual({ providerID: "mock", modelID: "agent-model" })
    expect(run.turn.model).not.toEqual({ providerID: "opencode", modelID: "tidepool-alpha-free" })
    await run.task
  })
})
