import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { Prompt, PromptStore } from "@/context/prompt"
import { ServerScope } from "@/utils/server-scope"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdSessions: string[] = []
type SessionCreateInput = {
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  location?: { directory: string }
}
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const sentShell: Array<{ sessionID: string; id?: string; command: string }> = []
const sentShellDirectories: string[] = []
const promotedDrafts: Array<{ draftID: string; server: string; sessionId: string }> = []
const sentPrompts: string[] = []
const promptInputs: unknown[] = []
const sentCommands: unknown[] = []
const switchedAgents: Array<{ sessionID: string; agent: string }> = []
const switchedModels: Array<{
  sessionID: string
  model: { id: string; providerID: string; variant?: string }
}> = []
const sessionRequestOrder: string[] = []
const updatedDrafts: Array<{ draftID: string; worktree?: string }> = []
const syncedServers: string[] = []
const optimisticServers: string[] = []
const promptCaptures: Array<{ scope?: unknown; target?: unknown }> = []
let serverSessionSyncs = 0

let params: { id?: string } = {}
let search: { draftId?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let createSessionGate: Promise<void> | undefined
let createWorktreeGate: Promise<void> | undefined
let worktreeFailure: Error | undefined
let locationFailure: Error | undefined
let worktreeCreates = 0
let activeSDK = "server-a"
let activeServerSync = "server-a"
let activeDirectorySync = "server-a"
let commands: Array<{ name: string }> = []
let worktreeDirectory = "/repo/new-0"
let worktreeID = 0
const draftServers: Record<string, string> = {}
const sessionDirectories: Record<string, string> = {}

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
const [promptStore, setPromptStore] = createStore<PromptStore>({
  prompt: promptValue,
  cursor: 0,
  context: { items: [] },
})
const prompt = {
  store: [() => promptStore, setPromptStore] as [() => PromptStore, typeof setPromptStore],
  ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
  current: () => promptValue,
  cursor: () => 0,
  dirty: () => true,
  model: {
    current: () => undefined,
    set: () => undefined,
  },
  reset: () => undefined,
  set: () => undefined,
  context: {
    add: () => undefined,
    remove: () => undefined,
    removeComment: () => undefined,
    updateComment: () => undefined,
    replaceComments: () => undefined,
    items: () => [],
  },
  capture: (scope?: unknown, target?: unknown) => {
    promptCaptures.push({ scope, target })
    return prompt
  },
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const clientFor = (directory: string) => {
  return {
    api: {
      session: {
        create: async (input: SessionCreateInput) => {
          await createSessionGate
          const location = input.location?.directory ?? directory
          createdSessions.push(location)
          const id = `session-${createdSessions.length}`
          sessionDirectories[id] = location
          return {
            id,
            projectID: "project",
            agent: input.agent,
            model: input.model,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
            title: `New session ${createdSessions.length}`,
            location: { directory: location },
          }
        },
        prompt: async (input: unknown) => {
          sessionRequestOrder.push("prompt")
          sentPrompts.push(sessionDirectories[(input as { sessionID: string }).sessionID] ?? directory)
          promptInputs.push(input)
          return { data: undefined }
        },
        switchAgent: async (input: { sessionID: string; agent: string }) => {
          sessionRequestOrder.push("agent")
          switchedAgents.push(input)
        },
        switchModel: async (input: {
          sessionID: string
          model: { id: string; providerID: string; variant?: string }
        }) => {
          sessionRequestOrder.push("model")
          switchedModels.push(input)
        },
        command: async (input: unknown) => {
          sentCommands.push(input)
        },
        shell: async (input: { sessionID: string; id?: string; command: string }) => {
          sentShell.push(input)
          sentShellDirectories.push(sessionDirectories[input.sessionID] ?? directory)
        },
      },
      worktree: {
        create: async (_input: unknown) => {
          worktreeCreates++
          await createWorktreeGate
          if (worktreeFailure) throw worktreeFailure
          return { directory: worktreeDirectory }
        },
      },
      location: {
        get: async () => {
          if (locationFailure) throw locationFailure
          return { directory: worktreeDirectory }
        },
      },
    },
    session: {
      command: async () => ({ data: undefined }),
      abort: async () => ({ data: undefined }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
    useLocation: () => ({}),
    useSearchParams: () => [search, () => undefined],
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    toaster: { create: () => undefined, show: () => undefined, dismiss: () => undefined },
    showToast: () => 0,
  }))

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@/context/local", () => ({
    useLocal: () => ({
      model: {
        current: () => ({ id: "model", provider: { id: "provider" } }),
        variant: { current: () => variant },
      },
      agent: {
        current: () => ({ name: "agent" }),
      },
      session: {
        promote: () => undefined,
      },
    }),
  }))

  mock.module("@/context/permission", () => {
    return { usePermission: () => ({ currentServerState: () => ({ enableAutoAccept: () => undefined }) }) }
  })

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      draft: (draftID: string) => ({ server: draftServers[draftID] ?? "project-server" }),
      updateDraft: (draftID: string, draft: { worktree?: string }) => {
        updatedDrafts.push({ draftID, ...draft })
      },
      promoteDraft: (draftID: string, session: { server: string; sessionId: string }) => {
        promotedDrafts.push({ draftID, ...session })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      return () => ({
        scope: activeSDK === "server-a" ? ServerScope.local : "server-b",
        directory: activeSDK === "server-a" ? "/repo/main" : "/repo/other",
        api: rootClient.api,
        url: "http://localhost:4096",
      })
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => {
      const server = activeDirectorySync
      return {
        data: { command: commands, project: "project" },
        session: {
          optimistic: {
            add: (value: {
              directory?: string
              sessionID?: string
              message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
            }) => {
              optimisticServers.push(server)
              optimistic.push(value)
            },
            remove: () => undefined,
          },
        },
        set: () => undefined,
        project: { worktree: server === "server-a" ? "/repo/main" : "/repo/other" },
      }
    },
  }))

  mock.module("@/context/server-sync", () => ({
    useServerSync: () => {
      const server = activeServerSync
      return {
        session: {
          remember: () => undefined,
          set: () => undefined,
          sync: async () => {
            serverSessionSyncs++
          },
        },
        child: (directory: string) => {
          syncedServers.push(server)
          storedSessions[directory] ??= []
          return [
            { session: storedSessions[directory] },
            (...args: unknown[]) => {
              if (args[0] !== "session") return
              const next = args[1]
              if (typeof next === "function") {
                storedSessions[directory] = next(storedSessions[directory]) as Array<{ id: string; title?: string }>
                return
              }
              if (Array.isArray(next)) {
                storedSessions[directory] = next as Array<{ id: string; title?: string }>
              }
            },
          ]
        },
      }
    },
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({
      fetch: fetch,
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
})

beforeEach(() => {
  createdSessions.length = 0
  optimistic.length = 0
  promotedDrafts.length = 0
  updatedDrafts.length = 0
  sentCommands.length = 0
  sentPrompts.length = 0
  promptInputs.length = 0
  switchedAgents.length = 0
  switchedModels.length = 0
  sessionRequestOrder.length = 0
  syncedServers.length = 0
  optimisticServers.length = 0
  promptCaptures.length = 0
  params = {}
  search = {}
  sentShell.length = 0
  sentShellDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  activeSDK = "server-a"
  activeServerSync = "server-a"
  activeDirectorySync = "server-a"
  commands = []
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  worktreeDirectory = `/repo/new-${++worktreeID}`
  createSessionGate = undefined
  serverSessionSyncs = 0
  createWorktreeGate = undefined
  worktreeFailure = undefined
  locationFailure = undefined
  worktreeCreates = 0
  for (const key of Object.keys(draftServers)) delete draftServers[key]
  for (const key of Object.keys(sessionDirectories)) delete sessionDirectories[key]
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

const event = { preventDefault: () => undefined } as unknown as Event
const makeSubmit = (overrides: Partial<Parameters<typeof createPromptSubmit>[0]> = {}) =>
  createPromptSubmit({
    prompt,
    info: () => undefined,
    imageAttachments: () => [],
    commentCount: () => 0,
    autoAccept: () => false,
    mode: () => "normal",
    working: () => false,
    editor: () => undefined,
    queueScroll: () => undefined,
    promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
    addToHistory: () => undefined,
    resetHistoryNavigation: () => undefined,
    setMode: () => undefined,
    setPopover: () => undefined,
    newSessionWorktree: () => selected,
    onNewSessionWorktreeReset: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  })

describe("prompt submit worktree selection", () => {
  test("admits only one concurrent new-workspace submission", async () => {
    selected = "create"
    let release = () => {}
    createWorktreeGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const submit = makeSubmit()

    const first = submit.handleSubmit(event)
    const duplicate = submit.handleSubmit(event)
    expect(worktreeCreates).toBe(1)

    release()
    await Promise.all([first, duplicate])
    expect(createdSessions).toEqual([worktreeDirectory])
    await settle()

    expect(worktreeCreates).toBe(1)
    expect(createdSessions).toHaveLength(1)
    expect(sentPrompts).toEqual([worktreeDirectory])
  })

  test("stops when the created workspace cannot initialize", async () => {
    selected = "create"
    locationFailure = new Error("initialization failed")

    await makeSubmit().handleSubmit(event)

    expect(worktreeCreates).toBe(1)
    expect(createdSessions).toEqual([])
    expect(sentPrompts).toEqual([])
  })

  test("keeps async submission effects bound to the initiating context", async () => {
    search = { draftId: "draft-1" }
    draftServers["draft-1"] = "project-server-a"
    draftServers["draft-2"] = "project-server-b"
    let release = () => {}
    createSessionGate = new Promise<void>((resolve) => {
      release = resolve
    })
    let submitted = 0
    const submit = makeSubmit({
      onSubmit: () => submitted++,
    })

    const result = submit.handleSubmit(event)
    activeSDK = "server-b"
    activeServerSync = "server-b"
    activeDirectorySync = "server-b"
    search.draftId = "draft-2"
    release()
    await result
    await settle()

    expect(updatedDrafts).toEqual([{ draftID: "draft-1", worktree: undefined }])
    expect(promotedDrafts).toEqual([{ draftID: "draft-1", server: "project-server-a", sessionId: "session-1" }])
    expect(syncedServers.every((server) => server === "server-a")).toBe(true)
    expect(optimisticServers).toEqual(["server-a"])
    expect(promptCaptures.at(-1)?.target).toEqual({ server: "project-server-a", scope: ServerScope.local })
    expect(submitted).toBe(0)
  })

  test("switches the selected agent and model before prompting", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = makeSubmit({
      info: () => ({
        id: "session-1",
        agent: "old-agent",
        model: { id: "old-model", providerID: "old-provider" },
      }),
    })

    await submit.handleSubmit(event)
    await Bun.sleep(0)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
    expect(sentPrompts).toEqual(["/repo/main"])
    expect(switchedAgents).toEqual([{ sessionID: "session-1", agent: "agent" }])
    expect(switchedModels).toEqual([
      {
        sessionID: "session-1",
        model: { id: "model", providerID: "provider", variant: "high" },
      },
    ])
    expect(sessionRequestOrder).toEqual(["agent", "model", "prompt"])
    expect(promptInputs[0]).toMatchObject({
      sessionID: "session-1",
      text: "ls",
      files: [],
      agents: [],
    })
    expect((promptInputs[0] as { id?: string }).id).toStartWith("msg_")
  })

  test("submits slash commands through the current session API", async () => {
    params = { id: "session-1" }
    variant = "high"
    commands.push({ name: "review" })
    promptValue = [{ type: "text", content: "/review staged changes", start: 0, end: 22 }]

    const submit = makeSubmit({
      info: () => ({ id: "session-1" }),
    })

    await submit.handleSubmit(event)
    await settle()

    expect(sentCommands).toEqual([
      {
        sessionID: "session-1",
        id: expect.stringMatching(/^msg_/),
        command: "review",
        arguments: "staged changes",
        agent: "agent",
        model: { id: "model", providerID: "provider", variant: "high" },
        files: [],
      },
    ])
    expect(serverSessionSyncs).toBe(0)
  })

  test("sends an initial shell after synchronous workspace creation", async () => {
    selected = "create"
    const submit = makeSubmit({
      mode: () => "shell",
    })

    await submit.handleSubmit(event)
    await settle()

    expect(sentShellDirectories).toEqual([worktreeDirectory])
    expect(sentShell[0]).toMatchObject({
      sessionID: "session-1",
      command: "ls",
    })
  })
})
