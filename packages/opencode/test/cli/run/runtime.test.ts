import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { FooterApi, RunProvider } from "@/cli/cmd/run/types"

type ModelInfo = {
  providers: RunProvider[]
  variants: string[]
  limits: Record<string, number>
}

type SessionInfo = {
  first: boolean
  history: []
  variant: string | undefined
}

const provider: RunProvider = {
  id: "openai",
  name: "OpenAI",
  source: "api",
  env: [],
  options: {},
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      api: {
        id: "openai",
        url: "https://openai.test",
        npm: "@ai-sdk/openai",
      },
      name: "Little Frank",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
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
      options: {},
      headers: {},
      release_date: "2026-01-01",
    },
  },
}

let modelInfoTask: Promise<ModelInfo> = Promise.resolve({
  providers: [provider],
  variants: [],
  limits: {},
})
let sessionInfo: SessionInfo = {
  first: false,
  history: [],
  variant: undefined,
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

void mock.module("@/cli/cmd/run/runtime.boot", () => ({
  resolveModelInfo: () => modelInfoTask,
  resolveRunTuiConfig: () =>
    Promise.resolve({
      keybinds: new Map(),
      leader_timeout: 2000,
      diff_style: "auto" as const,
    }),
  resolveSessionInfo: () => Promise.resolve(sessionInfo),
}))

void mock.module("@/cli/cmd/run/runtime.lifecycle", () => ({
  createRuntimeLifecycle: async () => ({
    footer: footer(),
    onResize: () => () => {},
    refreshTheme: () => {},
    resetForReplay: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}))

void mock.module("@/cli/cmd/run/stream.transport", () => ({
  createSessionTransport: async (input: { providers?: () => RunProvider[]; footer: FooterApi }) => {
    transportProviders.push(input.providers?.() ?? [])
    setTimeout(() => {
      input.footer.close()
    }, 0)
    return {
      runPromptTurn: async () => {},
      selectSubagent: () => {},
      replayOnResize: async () => false,
      close: async () => {},
    }
  },
}))

void mock.module("@/cli/cmd/run/otel", () => ({
  withRunSpan: async (_name: string, _attrs: Record<string, unknown>, fn: (span: object) => Promise<unknown>) => fn({}),
  recordRunSpanError: () => {},
  setRunSpanAttributes: () => {},
}))

void mock.module("@/cli/cmd/run/trace", () => ({
  trace: () => undefined,
}))

void mock.module("@/cli/cmd/run/variant.shared", () => ({
  cycleVariant: () => undefined,
  formatModelLabel: (model: { modelID: string } | undefined) => model?.modelID ?? "",
  pickVariant: () => undefined,
  resolveSavedVariant: () => Promise.resolve(undefined),
  resolveVariant: (input: string | undefined, session: string | undefined, saved: string | undefined) =>
    input ?? session ?? saved,
  saveVariant: () => Promise.resolve(),
}))

const { runInteractiveMode } = await import("@/cli/cmd/run/runtime")

afterEach(() => {
  mock.restore()
  transportProviders.length = 0
  modelInfoTask = Promise.resolve({
    providers: [provider],
    variants: [],
    limits: {},
  })
  sessionInfo = {
    first: false,
    history: [],
    variant: undefined,
  }
})

describe("run interactive runtime", () => {
  test("waits for provider metadata before eager replay transport bootstrap", async () => {
    const gate = defer<ModelInfo>()
    modelInfoTask = gate.promise

    const sdk = new OpencodeClient()
    spyOn(sdk.session, "get").mockRejectedValue(new Error("not needed"))
    spyOn(sdk.app, "agents").mockImplementation(() => ok([]))
    spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
    spyOn(sdk.command, "list").mockImplementation(() => ok([]))

    const task = runInteractiveMode({
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
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(transportProviders).toEqual([])

    gate.resolve({
      providers: [provider],
      variants: [],
      limits: {},
    })

    await task

    expect(transportProviders).toEqual([[provider]])
  })
})
