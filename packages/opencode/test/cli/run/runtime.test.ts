import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient } from "@opencode-ai/sdk/v2"
import { runInteractiveMode } from "@/cli/cmd/run/runtime"
import type { FooterApi, RunProvider } from "@/cli/cmd/run/types"

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

function footer(): FooterApi {
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
    event() {},
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
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
        variant: undefined,
        files: [],
        thinking: true,
        backgroundSubagents: false,
      },
      {
        createRuntimeLifecycle: async () => ({
          footer: footer(),
          onResize: () => () => {},
          refreshTheme: () => {},
          resetForReplay: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }),
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

    expect(transportProviders).toEqual([[provider]])
    expect(legacyProviders).not.toHaveBeenCalled()
    expect(legacyAgents).not.toHaveBeenCalled()
    expect(legacyCommands).not.toHaveBeenCalled()
  })
})
