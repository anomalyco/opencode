import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode-ai/client/promise"
import { runMiniFrontend } from "../../src/mini"
import { runInteractiveDeferredMode, runInteractiveMode } from "../../src/mini/runtime"
import type { LifecycleInput } from "../../src/mini/runtime.lifecycle"
import type { FooterApi, FooterEvent, MiniHost, RunProvider } from "../../src/mini/types"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

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
  return Promise.resolve(data)
}

function host(): MiniHost {
  return {
    terminal: { stdin: process.stdin, cleanup() {} },
    platform: "linux",
    stdout: { write() {} },
    files: { readText: async () => "" },
    editor: { open: async () => undefined },
    paths: { home: "/home/test", state: "/tmp/state", log: "/tmp/log" },
    signals: {
      sigint: { subscribe: () => () => {} },
      sigusr2: { subscribe: () => () => {} },
    },
    startup: { showTiming: false, now: () => 0 },
    diagnostics: { pid: 1, cwd: "/tmp", argv: [] },
    themes: { discover: async () => ({}) },
    preferences: {
      resolveVariant: async () => undefined,
      saveVariant: async () => {},
    },
  }
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
  test("routes form responses to their owners with global location and local settlement", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const api = footer()
    const streamStarted = defer<void>()
    let lifecycle!: LifecycleInput
    const settled: Array<{ sessionID: string; formID: string }> = []
    spyOn(sdk.provider, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.model, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    const reply = spyOn(sdk.form, "reply").mockImplementation(() => ok(undefined))

    const task = runInteractiveMode(
      {
        host: host(),
        sdk,
        location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
        projectID: "pro-1",
        sessionID: "ses_root",
        resume: false,
        agent: "build",
        model: { providerID: "test", modelID: "model" },
        variant: undefined,
        files: [],
        thinking: false,
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
          return {
            footer: api,
            onResize: () => () => {},
            refreshTheme: () => {},
            resetForReplay: () => Promise.resolve(),
            close: () => Promise.resolve(),
          }
        },
        streamTransport: Promise.resolve({
          createSessionTransport: async () => {
            streamStarted.resolve()
            return {
              runPromptTurn: async () => {},
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
      location: { directory: "/remote work", workspaceID: "wrk_1" },
    })
    expect(reply).toHaveBeenCalledWith(
      {
        sessionID: "global",
        formID: "frm_global",
        answer: { value: "yes" },
        location: { directory: "/remote work", workspaceID: "wrk_1" },
      },
      {
        headers: {
          "x-opencode-directory": "%2Fremote%20work",
          "x-opencode-workspace": "wrk_1",
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

  test("leaves host terminal cleanup to the caller when startup fails before renderer creation", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const inputHost = host()
    let cleaned = 0
    inputHost.terminal.cleanup = () => {
      cleaned++
    }
    inputHost.preferences.resolveVariant = async () => {
      throw new Error("preference failed")
    }

    await expect(
      runMiniFrontend({
        host: inputHost,
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-never",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
          projectID: "pro-1",
          agent: "review",
          model: undefined,
          variant: undefined,
          resume: false,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
      }),
    ).rejects.toThrow("preference failed")
    expect(cleaned).toBe(0)
  })

  test("resolves the deferred session only after first paint", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    let resolved = 0
    api.idle = () => painted.promise
    spyOn(sdk.provider, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.model, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)

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
            location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
            projectID: "pro-1",
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
        thinking: false,
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
    spyOn(sdk.provider, "list").mockImplementation(
      () =>
        ok({
          location: { directory: "/tmp" },
          data: [{ id: "openai", name: "OpenAI", request: { headers: {}, body: {} } }],
        }) as never,
    )
    spyOn(sdk.model, "list").mockImplementation(
      () =>
        ok({
          location: { directory: "/tmp" },
          data: [
            {
              id: "gpt-5",
              providerID: "openai",
              name: "Little Frank",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              request: { headers: {}, body: {} },
              variants: [{ id: "high", settings: {}, headers: {}, body: {} }],
              time: { released: 1 },
              cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
              status: "active",
              enabled: true,
              limit: { context: 128000, output: 8192 },
            },
          ],
        }) as never,
    )
    spyOn(sdk.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume",
          sessionTitle: "Resume",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
          projectID: "pro-1",
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5" },
          variant: "high",
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
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
    expect(sdk.session.get).not.toHaveBeenCalled()
    painted.resolve()
    await task

    expect(events).toContainEqual({
      type: "history",
      history: [{ text: "previous prompt", parts: [] }],
    })
    expect(events).toContainEqual({ type: "agent", agent: "review" })
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
    const response = { location: { directory: "/tmp" }, data: [] }
    spyOn(sdk.provider, "list").mockResolvedValue(response as never)
    spyOn(sdk.model, "list").mockResolvedValue(response as never)
    spyOn(sdk.agent, "list").mockResolvedValue(response as never)
    spyOn(sdk.reference, "list").mockResolvedValue(response as never)
    spyOn(sdk.command, "list").mockResolvedValue(response as never)
    spyOn(sdk.skill, "list").mockResolvedValue(response as never)

    const task = runInteractiveDeferredMode(
      {
        host: host(),
        sdk,
        directory: "/tmp",
        target: async () => ({
          sessionID: "ses-resume-abort",
          sessionTitle: "Cached title",
          location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
          projectID: "pro-1",
          agent: "build",
          model: undefined,
          variant: undefined,
          resume: true,
        }),
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: api,
          onResize: () => () => {},
          refreshTheme: () => {},
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

  test("adopts the deferred target location for catalogs, files, and runtime placement", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    let targets = 0
    let getDirectory: (() => string) | undefined
    let findFiles: ((query: string) => Promise<string[]>) | undefined
    let transportLocation: unknown
    const response = { location: { directory: "/session", workspaceID: "work-1" }, data: [] }
    const providerList = spyOn(sdk.provider, "list").mockResolvedValue(response as never)
    const modelList = spyOn(sdk.model, "list").mockResolvedValue(response as never)
    const agentList = spyOn(sdk.agent, "list").mockResolvedValue(response as never)
    const referenceList = spyOn(sdk.reference, "list").mockResolvedValue(response as never)
    const commandList = spyOn(sdk.command, "list").mockResolvedValue(response as never)
    const skillList = spyOn(sdk.skill, "list").mockResolvedValue(response as never)
    const fileFind = spyOn(sdk.file, "find").mockResolvedValue({
      location: {
        directory: "/session",
        workspaceID: "work-1",
        project: { id: "pro-1", directory: "/session" },
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
              project: { id: "location-project", directory: "/session" },
            },
            projectID: "session-project",
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
      },
      {
        createRuntimeLifecycle: async (input) => {
          getDirectory = input.getDirectory
          findFiles = input.findFiles
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
          createSessionTransport: async (input) => {
            transportLocation = input.location
            await findFiles?.("index")
            setTimeout(() => input.footer.close(), 0)
            return {
              runPromptTurn: async () => {},
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

    const query = { location: { directory: "/session", workspace: "work-1" } }
    expect(getDirectory?.()).toBe("/session")
    expect(transportLocation).toMatchObject({ directory: "/session", workspaceID: "work-1" })
    expect(providerList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(modelList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(agentList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(referenceList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(commandList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(skillList).toHaveBeenCalledWith(query, { signal: expect.any(AbortSignal) })
    expect(fileFind).toHaveBeenCalledWith({ query: "index", type: "file", ...query })
  })

  test("uses the replacement client for runtime APIs, catalogs, and new sessions", async () => {
    const initial = OpenCode.make({ baseUrl: "https://initial.opencode.test" })
    const replacement = OpenCode.make({ baseUrl: "https://replacement.opencode.test" })
    const api = footer()
    const response = { location: { directory: "/tmp" }, data: [] }
    for (const client of [initial, replacement]) {
      spyOn(client.provider, "list").mockResolvedValue(response as never)
      spyOn(client.model, "list").mockResolvedValue(response as never)
      spyOn(client.agent, "list").mockResolvedValue(response as never)
      spyOn(client.reference, "list").mockResolvedValue(response as never)
      spyOn(client.command, "list").mockResolvedValue(response as never)
      spyOn(client.skill, "list").mockResolvedValue(response as never)
      spyOn(client.message, "list").mockResolvedValue({ data: [], cursor: {} })
    }
    spyOn(initial.session, "get").mockResolvedValue({
      id: "ses-current",
      projectID: "pro-1",
      title: "Current",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1 },
      location: { directory: "/tmp" },
      model: { providerID: "openai", id: "gpt-5" },
    } as never)
    spyOn(replacement.session, "get").mockResolvedValue({
      id: "ses-new",
      projectID: "pro-1",
      title: "Replacement",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 2, updated: 2 },
      location: { directory: "/tmp" },
      model: { providerID: "openai", id: "gpt-5" },
    } as never)
    const find = spyOn(replacement.file, "find").mockResolvedValue({
      location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
      data: [{ path: "src/replacement.ts", type: "file" }],
    } as never)
    const permission = spyOn(replacement.permission, "reply").mockImplementation(() => ok(undefined))
    const formReply = spyOn(replacement.form, "reply").mockImplementation(() => ok(undefined))
    const formCancel = spyOn(replacement.form, "cancel").mockImplementation(() => ok(undefined))
    const background = spyOn(replacement.session, "background").mockImplementation(() => ok(undefined))
    const interrupt = spyOn(replacement.session, "interrupt").mockImplementation(() => ok(undefined))
    let lifecycle!: LifecycleInput
    let createdWith: unknown

    await runInteractiveMode(
      {
        host: host(),
        sdk: initial,
        reconnect: async () => replacement,
        location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
        projectID: "pro-1",
        sessionID: "ses-current",
        sessionTitle: "Current",
        resume: true,
        replay: false,
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: undefined,
        files: [],
        thinking: false,
        initialInput: "/new",
        createSession: async (client, input) => {
          createdWith = client
          expect(await lifecycle.findFiles("replacement")).toEqual(["src/replacement.ts"])
          await lifecycle.onPermissionReply({ sessionID: "ses-current", requestID: "per-1", reply: "once" })
          await lifecycle.onFormReply({ sessionID: "ses-current", formID: "frm-1", answer: { value: "yes" } })
          await lifecycle.onFormCancel({ sessionID: "ses-current", formID: "frm-2" })
          lifecycle.onBackground?.()
          lifecycle.onSubagentInterrupt?.("ses-child")
          await Bun.sleep(0)
          api.close()
          return {
            sessionID: "ses-new",
            sessionTitle: "Replacement",
            location: { ...input.location, project: { id: "pro-1", directory: input.location.directory } },
            projectID: "pro-1",
            agent: input.agent,
            model: input.model,
            variant: input.variant,
            resume: false,
          }
        },
      },
      {
        createRuntimeLifecycle: async (input) => {
          lifecycle = input
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
            input.onClient?.(replacement)
            await input.onCatalogRefresh?.()
            return {
              runPromptTurn: async () => {},
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

    expect(createdWith).toBe(replacement)
    expect(find).toHaveBeenCalled()
    expect(permission).toHaveBeenCalled()
    expect(formReply).toHaveBeenCalled()
    expect(formCancel).toHaveBeenCalled()
    expect(background).toHaveBeenCalledWith({ sessionID: "ses-current" })
    expect(interrupt).toHaveBeenCalledWith({ sessionID: "ses-child" })
    expect(replacement.provider.list).toHaveBeenCalled()
  })

  test("waits for provider metadata before eager replay transport bootstrap", async () => {
    const providersStarted = defer<void>()
    const providers = defer<void>()
    const lifecycleModels: unknown[] = []

    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    spyOn(sdk.provider, "list").mockImplementation(async () => {
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
    spyOn(sdk.model, "list").mockImplementation(
      () =>
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
    spyOn(sdk.message, "list").mockImplementation(() =>
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
    spyOn(sdk.session, "get").mockImplementation(
      () =>
        ok({
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
        }) as never,
    )
    spyOn(sdk.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)

    const task = runInteractiveMode(
      {
        host: host(),
        sdk,
        location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
        projectID: "pro-1",
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
  })

  test("defers catalog-selected model resolution until after first paint", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
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

    spyOn(sdk.model, "default").mockImplementation(async () => {
      defaultRequested = true
      defaultStarted.resolve()
      await releaseDefault.promise
      return ok({
        location: { directory: "/tmp" },
        data: { id: "catalog-default-test-model", providerID: "openai" },
      }) as never
    })
    spyOn(sdk.provider, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.model, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.agent, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.reference, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.command, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)
    spyOn(sdk.skill, "list").mockImplementation(() => ok({ location: { directory: "/tmp" }, data: [] }) as never)

    const task = runInteractiveMode(
      {
        host: host(),
        sdk,
        location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
        projectID: "pro-1",
        sessionID: "ses-fresh",
        resume: false,
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
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
      model: "catalog-default-test-model · openai",
      selection: { providerID: "openai", modelID: "catalog-default-test-model" },
    })
  })

  test("does not start deferred work after the footer closes", async () => {
    const sdk = OpenCode.make({ baseUrl: "https://opencode.test" })
    const lifecycleStarted = defer<void>()
    const painted = defer<void>()
    const api = footer()
    api.idle = () => painted.promise
    const defaultModel = spyOn(sdk.model, "default")

    const task = runInteractiveMode(
      {
        host: host(),
        sdk,
        location: { directory: "/tmp", project: { id: "pro-1", directory: "/tmp" } },
        projectID: "pro-1",
        sessionID: "ses-closed",
        resume: false,
        agent: "build",
        model: undefined,
        variant: undefined,
        files: [],
        thinking: false,
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
})
