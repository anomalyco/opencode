import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

const createdClients: string[] = []
const createdSessions: string[] = []
const enabledAutoAccept: Array<{ sessionID: string; directory: string }> = []
const optimistic: Array<{
  directory?: string
  sessionID?: string
  message: {
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }
}> = []
const optimisticSeeded: boolean[] = []
const storedSessions: Record<string, Array<{ id: string; title?: string }>> = {}
const promoted: Array<{ directory: string; sessionID: string }> = []
const sentShell: string[] = []
const stoppedSessions: string[] = []
const sentCommands: Array<{ directory: string; command: string; arguments: string }> = []
const syncedDirectories: string[] = []
const setModeCalls: string[] = []
const setPopoverCalls: Array<"at" | "slash" | null> = []
const followupPendingCalls: boolean[] = []
const replacedCommentSnapshots: Array<Array<{ file: string; comment: string }>> = []

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let availableCommands: Array<{ name: string }> = []
let contextItems: Array<{ key: string; type: string; path?: string; comment?: string }> = []
let commentItems: Array<{ file: string; comment: string; selection: { start: number; end: number }; id: string; time: number }> =
  []
let commandHandler:
  | ((input: { sessionID: string; command: string; arguments: string; parts: unknown[] }) => Promise<{ data: undefined }>)
  | undefined
let promptAsyncHandler:
  | ((input: { sessionID: string; messageID: string; parts: unknown[] }) => Promise<{ data: undefined }>)
  | undefined
let stopHandler: ((input: { sessionID: string }) => Promise<{ data: undefined }>) | undefined

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
let promptResetCalls = 0
const promptSetCalls: Array<{ prompt: Prompt; cursor?: number }> = []
let commentClearCalls = 0
let rejectCommand: ((error: unknown) => void) | undefined
let rejectPromptAsync: ((error: unknown) => void) | undefined

const clientFor = (directory: string) => {
  createdClients.push(directory)
  return {
    session: {
      create: async () => {
        createdSessions.push(directory)
        return {
          data: {
            id: `session-${createdSessions.length}`,
            title: `New session ${createdSessions.length}`,
          },
        }
      },
      shell: async () => {
        sentShell.push(directory)
        return { data: undefined }
      },
      prompt: async () => ({ data: undefined }),
      promptAsync: async (input: { sessionID: string; messageID: string; parts: unknown[] }) => {
        if (promptAsyncHandler) return promptAsyncHandler(input)
        return { data: undefined }
      },
      command: async (input: { sessionID: string; command: string; arguments: string; parts: unknown[] }) => {
        sentCommands.push({ directory, command: input.command, arguments: input.arguments })
        if (commandHandler) return commandHandler(input)
        return { data: undefined }
      },
      stop: async (input: { sessionID: string }) => {
        stoppedSessions.push(input.sessionID)
        if (stopHandler) return stopHandler(input)
        return { data: undefined }
      },
      abort: async () => ({ data: undefined }),
    },
    worktree: {
      create: async () => ({ data: { directory: `${directory}/new` } }),
    },
  }
}

beforeAll(async () => {
  const rootClient = clientFor("/repo/main")

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => params,
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    showToast: () => 0,
  }))

  mock.module("@opencode-ai/util/encode", () => ({
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
        promote(directory: string, sessionID: string) {
          promoted.push({ directory, sessionID })
        },
      },
    }),
  }))

  mock.module("@/context/permission", () => ({
    usePermission: () => ({
      enableAutoAccept(sessionID: string, directory: string) {
        enabledAutoAccept.push({ sessionID, directory })
      },
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => {
        promptResetCalls += 1
        promptValue = []
      },
      set: (value: Prompt, cursor?: number) => {
        promptValue = value
        promptSetCalls.push({ prompt: value, cursor })
      },
      context: {
        add: (item: { key?: string; type: string; path?: string; comment?: string }) => {
          const key = item.key ?? `${item.type}:${item.path ?? item.comment ?? contextItems.length}`
          if (contextItems.find((value) => value.key === key)) return
          contextItems.push({ key, ...item })
        },
        remove: (key: string) => {
          contextItems = contextItems.filter((item) => item.key !== key)
        },
        items: () => contextItems,
      },
    }),
  }))

  mock.module("@/context/comments", () => ({
    useComments: () => ({
      all: () => commentItems,
      replace: (items: typeof commentItems) => {
        commentItems = items.map((item) => ({ ...item, selection: { ...item.selection } }))
        replacedCommentSnapshots.push(commentItems.map((item) => ({ file: item.file, comment: item.comment })))
      },
      clear: () => {
        commentClearCalls += 1
        commentItems = []
      },
    }),
  }))

  mock.module("@/context/layout", () => ({
    useLayout: () => ({
      handoff: {
        setTabs: () => undefined,
      },
    }),
  }))

  mock.module("@/context/sdk", () => ({
    useSDK: () => {
      const sdk = {
        directory: "/repo/main",
        client: rootClient,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: availableCommands },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string; variant?: string } }
          }) => {
            optimistic.push(value)
            optimisticSeeded.push(
              !!value.directory &&
                !!value.sessionID &&
                !!storedSessions[value.directory]?.find((item) => item.id === value.sessionID)?.title,
            )
          },
          remove: () => undefined,
        },
      },
      set: () => undefined,
    }),
  }))

  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => ({
      todo: {
        set: () => undefined,
      },
      child: (directory: string) => {
        syncedDirectories.push(directory)
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
    }),
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
  createdClients.length = 0
  createdSessions.length = 0
  enabledAutoAccept.length = 0
  optimistic.length = 0
  optimisticSeeded.length = 0
  promoted.length = 0
  params = {}
  sentShell.length = 0
  stoppedSessions.length = 0
  syncedDirectories.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  promptResetCalls = 0
  promptSetCalls.length = 0
  commentClearCalls = 0
  setModeCalls.length = 0
  setPopoverCalls.length = 0
  followupPendingCalls.length = 0
  sentCommands.length = 0
  replacedCommentSnapshots.length = 0
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
  availableCommands = []
  contextItems = []
  commentItems = []
  commandHandler = undefined
  promptAsyncHandler = undefined
  stopHandler = undefined
  rejectCommand = undefined
  rejectPromptAsync = undefined
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
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
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    selected = "/repo/worktree-b"
    promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
    await submit.handleSubmit(event)

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
  })

  test("applies auto-accept to newly created sessions", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
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
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
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
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model", variant: "high" },
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    const submit = createPromptSubmit({
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
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(storedSessions["/repo/worktree-a"]).toEqual([{ id: "session-1", title: "New session 1" }])
    expect(optimisticSeeded).toEqual([true])
  })
})

describe("followup result handling", () => {
  test("keeps the draft when queueing is blocked", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "queued draft", start: 0, end: 12 }]
    let queueCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
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
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => false,
      followupLane: () => "queue",
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onQueue: async () => {
        queueCalls += 1
        return { kind: "blocked", reason: "mutation_in_flight" } as const
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(queueCalls).toBe(1)
    expect(followupPendingCalls).toEqual([true, false])
    expect(promptResetCalls).toBe(0)
    expect(commentClearCalls).toBe(0)
    expect(promptSetCalls).toHaveLength(0)
  })

  test("keeps the draft when steering is blocked", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "steer draft", start: 0, end: 11 }]
    let steerCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => true,
      followupLane: () => "steer",
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onSteer: async () => {
        steerCalls += 1
        return { kind: "blocked", reason: "cannot_steer_now" } as const
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(steerCalls).toBe(1)
    expect(followupPendingCalls).toEqual([true, false])
    expect(promptResetCalls).toBe(0)
    expect(commentClearCalls).toBe(0)
    expect(promptSetCalls).toHaveLength(0)
  })

  test("clears the draft when queueing is applied", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "queued draft", start: 0, end: 12 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
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
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => false,
      followupLane: () => "queue",
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onQueue: async () =>
        ({
          kind: "applied",
          state: { paused: false, steer: [], queue: [] },
        }) as const,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(followupPendingCalls).toEqual([true, false])
    expect(promptResetCalls).toBe(1)
    expect(commentClearCalls).toBe(1)
    expect(setModeCalls).toContain("normal")
    expect(setPopoverCalls).toContain(null)
  })

  test("does not submit when the composer is blocked", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "blocked", start: 0, end: 7 }]
    let queueCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
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
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => true,
      followupLane: () => undefined,
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onQueue: async () => {
        queueCalls += 1
        return { kind: "applied", state: { paused: false, steer: [], queue: [] } }
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(queueCalls).toBe(0)
    expect(followupPendingCalls).toHaveLength(0)
    expect(promptResetCalls).toBe(0)
  })

  test("does not abort a running session when an edit draft is empty", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "", start: 0, end: 0 }]
    let editSubmitCalls = 0
    let abortCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      edit: () => ({ id: "pending-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onEditSubmit: async () => {
        editSubmitCalls += 1
        return { kind: "applied", state: { paused: false, steer: [], queue: [] } }
      },
      onAbort: () => {
        abortCalls += 1
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(editSubmitCalls).toBe(0)
    expect(abortCalls).toBe(0)
    expect(stoppedSessions).toEqual([])
    expect(followupPendingCalls).toHaveLength(0)
    expect(promptResetCalls).toBe(0)
  })

  test("preserves optimistic abort projection after remote stop succeeds", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "", start: 0, end: 0 }]
    let abortCalls = 0
    let rollbackCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      edit: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onAbort: () => {
        abortCalls += 1
        return () => {
          rollbackCalls += 1
        }
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Promise.resolve()
    await Promise.resolve()

    expect(stoppedSessions).toEqual(["session-1"])
    expect(abortCalls).toBe(1)
    expect(rollbackCalls).toBe(0)
    expect(promptResetCalls).toBe(0)
  })

  test("rolls back optimistic abort projection when remote stop fails", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "", start: 0, end: 0 }]
    let abortCalls = 0
    let rollbackCalls = 0
    stopHandler = async () => {
      throw new Error("stop failed")
    }

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      edit: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onAbort: () => {
        abortCalls += 1
        return () => {
          rollbackCalls += 1
        }
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Promise.resolve()
    await Promise.resolve()

    expect(stoppedSessions).toEqual(["session-1"])
    expect(abortCalls).toBe(1)
    expect(rollbackCalls).toBe(1)
    expect(promptResetCalls).toBe(0)
  })

  test("queue followup still runs when foreground submit is blocked", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "queued draft", start: 0, end: 12 }]
    let queueCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => true,
      followupLane: () => "queue",
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onQueue: async () => {
        queueCalls += 1
        return {
          kind: "applied",
          state: { paused: false, steer: [], queue: [] },
        } as const
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(queueCalls).toBe(1)
    expect(promptResetCalls).toBe(1)
    expect(commentClearCalls).toBe(1)
  })

  test("steer followup still runs when foreground submit is blocked", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "steer draft", start: 0, end: 11 }]
    let steerCalls = 0

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => true,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      submitBlocked: () => true,
      followupLane: () => "steer",
      followupPending: () => false,
      setFollowupPending: (pending) => followupPendingCalls.push(pending),
      onSteer: async () => {
        steerCalls += 1
        return {
          kind: "applied",
          state: { paused: false, steer: [], queue: [] },
        } as const
      },
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(steerCalls).toBe(1)
    expect(promptResetCalls).toBe(1)
    expect(commentClearCalls).toBe(1)
  })
})

describe("custom slash command cleanup", () => {
  test("clears consumed context and comments after a successful custom command submit", async () => {
    params = { id: "session-1" }
    availableCommands = [{ name: "fix" }]
    promptValue = [{ type: "text", content: "/fix arg", start: 0, end: 8 }]
    contextItems = [{ key: "ctx:file", type: "file", path: "src/app.ts", comment: "look here" }]
    commentItems = [{ id: "c1", file: "src/app.ts", comment: "look here", time: 1, selection: { start: 1, end: 1 } }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 1,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    expect(sentCommands).toEqual([{ directory: "/repo/main", command: "fix", arguments: "arg" }])
    expect(promptResetCalls).toBe(1)
    expect(commentClearCalls).toBe(1)
    expect(contextItems).toEqual([])
    expect(commentItems).toEqual([])
  })

  test("restores consumed context and comments if a custom command submit fails", async () => {
    params = { id: "session-1" }
    availableCommands = [{ name: "fix" }]
    promptValue = [{ type: "text", content: "/fix arg", start: 0, end: 8 }]
    contextItems = [{ key: "ctx:file", type: "file", path: "src/app.ts", comment: "look here" }]
    commentItems = [{ id: "c1", file: "src/app.ts", comment: "look here", time: 1, selection: { start: 1, end: 1 } }]
    commandHandler = async () => {
      throw new Error("boom")
    }

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 1,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await Promise.resolve()
    await Promise.resolve()

    expect(sentCommands).toEqual([{ directory: "/repo/main", command: "fix", arguments: "arg" }])
    expect(promptResetCalls).toBe(1)
    expect(commentClearCalls).toBe(1)
    expect(replacedCommentSnapshots).toEqual([[{ file: "src/app.ts", comment: "look here" }]])
    expect(contextItems).toEqual([{ key: "ctx:file", type: "file", path: "src/app.ts", comment: "look here" }])
    expect(commentItems.map((item) => ({ file: item.file, comment: item.comment }))).toEqual([
      { file: "src/app.ts", comment: "look here" },
    ])
  })

  test("does not overwrite a newer draft when a custom command submit fails later", async () => {
    params = { id: "session-1" }
    availableCommands = [{ name: "fix" }]
    promptValue = [{ type: "text", content: "/fix arg", start: 0, end: 8 }]
    contextItems = [{ key: "ctx:file", type: "file", path: "src/app.ts", comment: "look here" }]
    commentItems = [{ id: "c1", file: "src/app.ts", comment: "look here", time: 1, selection: { start: 1, end: 1 } }]
    commandHandler = () =>
      new Promise((_, reject) => {
        rejectCommand = reject
      })

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 1,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    promptValue = [{ type: "text", content: "new draft", start: 0, end: 9 }]
    contextItems = [{ key: "ctx:new", type: "file", path: "src/next.ts", comment: "new note" }]
    commentItems = [{ id: "c2", file: "src/next.ts", comment: "new note", time: 2, selection: { start: 2, end: 2 } }]

    rejectCommand?.(new Error("boom"))
    await Promise.resolve()
    await Promise.resolve()

    expect(promptValue).toEqual([{ type: "text", content: "new draft", start: 0, end: 9 }])
    expect(contextItems).toEqual([{ key: "ctx:new", type: "file", path: "src/next.ts", comment: "new note" }])
    expect(commentItems.map((item) => ({ file: item.file, comment: item.comment }))).toEqual([
      { file: "src/next.ts", comment: "new note" },
    ])
  })

  test("does not overwrite a newer draft when a foreground async send fails later", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "hello", start: 0, end: 5 }]
    contextItems = [{ key: "ctx:file", type: "file", path: "src/app.ts", comment: "look here" }]
    commentItems = [{ id: "c1", file: "src/app.ts", comment: "look here", time: 1, selection: { start: 1, end: 1 } }]
    promptAsyncHandler = () =>
      new Promise((_, reject) => {
        rejectPromptAsync = reject
      })

    const submit = createPromptSubmit({
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 1,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: (value) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: (mode) => setModeCalls.push(mode),
      setPopover: (popover) => setPopoverCalls.push(popover),
      onSubmit: () => undefined,
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)

    promptValue = [{ type: "text", content: "new draft", start: 0, end: 9 }]
    contextItems = [{ key: "ctx:new", type: "file", path: "src/next.ts", comment: "new note" }]
    commentItems = [{ id: "c2", file: "src/next.ts", comment: "new note", time: 2, selection: { start: 2, end: 2 } }]

    rejectPromptAsync?.(new Error("boom"))
    await Promise.resolve()
    await Promise.resolve()

    expect(promptValue).toEqual([{ type: "text", content: "new draft", start: 0, end: 9 }])
    expect(contextItems).toEqual([{ key: "ctx:new", type: "file", path: "src/next.ts", comment: "new note" }])
    expect(commentItems.map((item) => ({ file: item.file, comment: item.comment }))).toEqual([
      { file: "src/next.ts", comment: "new note" },
    ])
  })
})
