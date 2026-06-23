import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import type { FollowupDraft } from "./submit"
import { ULTRACODE_PROMPT_DIRECTIVE } from "./ultracode"
import { resetSessionApprovalForTest } from "@/components/dialog-workflow-approval-helpers"

let createPromptSubmit: typeof import("./submit").createPromptSubmit
let sendFollowupDraft: typeof import("./submit").sendFollowupDraft

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
const syncedDirectories: string[] = []
const workflowStarts: Array<{
  name: string
  directory?: string
  args?: Record<string, unknown>
  budget?: number
  permission?: string
}> = []
const toasts: Array<{ title?: string; description?: string }> = []
const promptParts: Array<Array<{ type: string; text?: string; synthetic?: boolean }>> = []
// Recorder for session.command: Bonus A asserts a workflow-sourced /<name> is
// NEVER executed as a session command (the empty-template bug).
const sessionCommands: Array<{ directory: string; command: string; arguments?: string }> = []
// Item 13: recorder for session.update — the ultracode toggle/submit persists
// session.metadata.ultracode via PATCH.
const sessionUpdates: Array<{ directory: string; sessionID: string; metadata?: Record<string, unknown> }> = []
// The server-registered command list surfaced via sync.data.command; entries
// with source:'workflow' are the discovery-only rows (empty template).
let commandList: Array<{ name: string; description?: string; source?: string }> = []
let dashboardOpened = 0
let workflowListData: Array<{ name: string; valid?: boolean; meta: { name: string; arguments?: any } }> = []
let workflowStartSessionId: string | undefined
// Approval gate test seams: the configured approval mode + the persisted
// approved list (read off sync.data.config.workflows), the canned reply the
// mocked approval dialog returns, how many times the dialog was shown, and the
// config writes the gate makes on "Yes, always".
let workflowApprovalMode: "always" | "first-run" | "never" | undefined
let workflowApprovedList: string[] = []
let workflowApprovalReply: "once" | "always" | "cancel" = "once"
let workflowApprovalShown = 0
const configUpdates: Array<Record<string, unknown>> = []

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let ultracodeSession = false
let keywordEnabled = true

// Mutable so tests can stage input by reassigning promptValue.
let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]
const prompt = {
  ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
  current: () => promptValue,
  cursor: () => undefined,
  dirty: () => true,
  context: {
    items: () => [],
    add: () => undefined,
    remove: () => undefined,
    removeComment: () => undefined,
    updateComment: () => undefined,
    replaceComments: () => undefined,
  },
  // No-ops (matching ours' original usePrompt mock): the existing tests stage
  // input by reassigning promptValue directly and expect current() to keep
  // returning it across multiple submits, so set/reset must NOT mutate it —
  // a side-effecting reset() would clear promptValue after the first submit and
  // make a second submit see empty input.
  set: () => undefined,
  reset: () => undefined,
}

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
      promptAsync: async (input: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> }) => {
        promptParts.push(input.parts)
        return { data: undefined }
      },
      command: async (input: { command: string; arguments?: string }) => {
        sessionCommands.push({ directory, command: input.command, arguments: input.arguments })
        return { data: undefined }
      },
      abort: async () => ({ data: undefined }),
      update: async (input: { sessionID: string; metadata?: Record<string, unknown> }) => {
        sessionUpdates.push({ directory, sessionID: input.sessionID, metadata: input.metadata })
        return { data: undefined }
      },
    },
    workflow: {
      list: async () => ({ data: workflowListData }),
      start: async (input: { name: string; directory?: string; workflowStartPayload?: any }) => {
        workflowStarts.push({
          name: input.name,
          directory: input.directory,
          args: input.workflowStartPayload?.args,
          budget: input.workflowStartPayload?.budget,
          permission: input.workflowStartPayload?.permissionSessionID,
        })
        return { data: { id: "run-1", session_id: workflowStartSessionId } }
      },
    },
    config: {
      update: async (input: { directory?: string; config?: Record<string, unknown> }) => {
        configUpdates.push(input.config ?? {})
        return { data: {} }
      },
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
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))

  mock.module("@opencode-ai/sdk/v2/client", () => ({
    createOpencodeClient: (input: { directory: string }) => {
      createdClients.push(input.directory)
      return clientFor(input.directory)
    },
  }))

  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: () => 0,
  }))

  mock.module("@/utils/toast", () => ({
    showToast: (input: { title?: string; description?: string }) => {
      toasts.push({ title: input?.title, description: input?.description })
      return 0
    },
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

  mock.module("@/context/server", () => ({
    useServer: () => ({ key: "server-key" }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      promoteDraft: () => undefined,
    }),
  }))

  mock.module("@/context/prompt", () => ({
    usePrompt: () => prompt,
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
        scope: "local",
        directory: "/repo/main",
        client: rootClient,
        url: "http://localhost:4096",
        createClient(opts: any) {
          return clientFor(opts.directory)
        },
      }
      return () => sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => () => ({
      data: {
        command: commandList,
        config: {
          workflows: {
            ultracode_keyword: keywordEnabled,
            approval: workflowApprovalMode,
            approved: workflowApprovedList,
          },
        },
      },
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

  mock.module("@/context/server-sync", () => ({
    useServerSync: () => () => ({
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

  mock.module("@opencode-ai/ui/context/dialog", () => ({
    useDialog: () => ({
      show: () => undefined,
      close: () => undefined,
    }),
  }))

  // The approval dialog is exercised in its own pure-helper + component context;
  // here we stub it to return the canned reply so the gate's branching (start /
  // cancel / persist consent) is what's under test.
  mock.module("@/components/dialog-workflow-approval", () => ({
    showWorkflowApproval: async () => {
      workflowApprovalShown += 1
      return workflowApprovalReply
    },
  }))

  const mod = await import("./submit")
  createPromptSubmit = mod.createPromptSubmit
  sendFollowupDraft = mod.sendFollowupDraft
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
  syncedDirectories.length = 0
  workflowStarts.length = 0
  toasts.length = 0
  promptParts.length = 0
  sessionCommands.length = 0
  sessionUpdates.length = 0
  commandList = []
  dashboardOpened = 0
  workflowListData = []
  workflowStartSessionId = undefined
  // Default to approval:"never" so the existing direct-start tests are unchanged;
  // the gate tests opt into first-run/always explicitly.
  workflowApprovalMode = "never"
  workflowApprovedList = []
  workflowApprovalReply = "once"
  workflowApprovalShown = 0
  // The "Yes, always" reply writes the module-level session cache — reset it so
  // one test's consent never leaks into another (the seam exists for this).
  resetSessionApprovalForTest()
  configUpdates.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  ultracodeSession = false
  keywordEnabled = true
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "shell",
      ultracodeSession: () => false,
      openWorkflowDashboard: () => undefined,
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
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => true,
      mode: () => "shell",
      ultracodeSession: () => false,
      openWorkflowDashboard: () => undefined,
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
      prompt,
      info: () => ({ id: "session-1" }),
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      ultracodeSession: () => false,
      openWorkflowDashboard: () => undefined,
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
      prompt,
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: () => 0,
      autoAccept: () => false,
      mode: () => "normal",
      ultracodeSession: () => false,
      openWorkflowDashboard: () => undefined,
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

const event = { preventDefault: () => undefined } as unknown as Event

// handleSubmit fires the prompt send / workflow start as a floating promise and
// returns before it settles. Flush several microtask + macrotask ticks so the
// floating async work (list → start, or buildRequestParts → promptAsync) lands
// before assertions.
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const workflowInput = () => ({
  prompt,
  info: () => ({ id: "session-1" }),
  imageAttachments: () => [],
  commentCount: () => 0,
  autoAccept: () => false,
  mode: () => "normal" as const,
  ultracodeSession: () => ultracodeSession,
  openWorkflowDashboard: () => {
    dashboardOpened += 1
  },
  working: () => false,
  editor: () => undefined,
  queueScroll: () => undefined,
  promptLength: (value: Prompt) => value.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0),
  addToHistory: () => undefined,
  resetHistoryNavigation: () => undefined,
  setMode: () => undefined,
  setPopover: () => undefined,
  onSubmit: () => undefined,
})

describe("workflow command routing on submit", () => {
  test("/workflows opens the dashboard and never sends a prompt", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "/workflows", start: 0, end: 10 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    expect(dashboardOpened).toBe(1)
    expect(workflowStarts).toEqual([])
    expect(promptParts).toEqual([])
  })

  test("/workflow with no name opens the dashboard", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "/workflow", start: 0, end: 9 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    expect(dashboardOpened).toBe(1)
    expect(workflowStarts).toEqual([])
  })

  test("/workflow <name> starts the run with declared-type-coerced args", async () => {
    params = { id: "session-1" }
    workflowListData = [
      { name: "review", valid: true, meta: { name: "review", arguments: { count: { type: "number" } } } },
    ]
    promptValue = [{ type: "text", content: "/workflow review count=3 tag=v1.0", start: 0, end: 33 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    expect(workflowStarts).toHaveLength(1)
    expect(workflowStarts[0]).toMatchObject({
      name: "review",
      directory: "/repo/main",
      args: { count: 3, tag: "v1.0" },
      permission: "session-1",
    })
    expect(promptParts).toEqual([])
    // approval:"never" (the test default) never opens the dialog.
    expect(workflowApprovalShown).toBe(0)
  })

  test("first-run gate asks, then starts on Yes (without persisting consent)", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowApprovalReply = "once"
    workflowListData = [{ name: "review", valid: true, meta: { name: "review" } }]
    promptValue = [{ type: "text", content: "/workflow review", start: 0, end: 16 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(1)
    expect(workflowStarts).toHaveLength(1)
    expect(workflowStarts[0]).toMatchObject({ name: "review", permission: "session-1" })
    // "Yes" (once) never writes consent.
    expect(configUpdates).toEqual([])
  })

  test("first-run gate aborts the start on No", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowApprovalReply = "cancel"
    workflowListData = [{ name: "review", valid: true, meta: { name: "review" } }]
    promptValue = [{ type: "text", content: "/workflow review", start: 0, end: 16 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(1)
    expect(workflowStarts).toEqual([])
  })

  test("Yes-always persists consent to workflows.approved and starts", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowApprovalReply = "always"
    workflowApprovedList = ["other"]
    workflowListData = [{ name: "review", valid: true, meta: { name: "review" } }]
    promptValue = [{ type: "text", content: "/workflow review", start: 0, end: 16 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(1)
    expect(workflowStarts).toHaveLength(1)
    // The approved list is rewritten whole with the appended name.
    expect(configUpdates).toEqual([{ workflows: { approved: ["other", "review"] } }])
  })

  test("an already-approved workflow under first-run starts without asking", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowApprovedList = ["review"]
    workflowListData = [{ name: "review", valid: true, meta: { name: "review" } }]
    promptValue = [{ type: "text", content: "/workflow review", start: 0, end: 16 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(0)
    expect(workflowStarts).toHaveLength(1)
  })

  test("an unknown workflow name skips the dialog and lets the engine report not-found", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowListData = []
    promptValue = [{ type: "text", content: "/workflow nope", start: 0, end: 14 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(0)
    // No info to gate, so the start still fires (the engine surfaces not-found).
    expect(workflowStarts).toHaveLength(1)
  })

  test("reserved budget= leaves the args and rides the start payload", async () => {
    params = { id: "session-1" }
    workflowListData = [{ name: "w", valid: true, meta: { name: "w" } }]
    promptValue = [{ type: "text", content: "/workflow w budget=5 msg=hi", start: 0, end: 27 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowStarts).toHaveLength(1)
    expect(workflowStarts[0]).toMatchObject({ name: "w", args: { msg: "hi" }, budget: 5 })
    expect(workflowStarts[0]?.args).not.toHaveProperty("budget")
  })

  test("a workflow-declared budget argument stays a normal arg (no payload budget)", async () => {
    params = { id: "session-1" }
    workflowListData = [{ name: "w", valid: true, meta: { name: "w", arguments: { budget: { type: "number" } } } }]
    promptValue = [{ type: "text", content: "/workflow w budget=5", start: 0, end: 20 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowStarts).toHaveLength(1)
    expect(workflowStarts[0]?.args).toEqual({ budget: 5 })
    expect(workflowStarts[0]?.budget).toBeUndefined()
  })

  test("budget=abc aborts the start with a toast", async () => {
    params = { id: "session-1" }
    workflowListData = [{ name: "w", valid: true, meta: { name: "w" } }]
    promptValue = [{ type: "text", content: "/workflow w budget=abc", start: 0, end: 22 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowStarts).toEqual([])
    expect(toasts.some((toast) => toast.title === "toast.workflow.budget.invalid.title")).toBe(true)
  })
})

describe("ultracode injection on submit", () => {
  // Item 13: the session toggle no longer injects a per-message directive —
  // the flag lives server-side (session.metadata.ultracode) and the server
  // renders the standing opt-in into the system prompt.
  test("session mode injects NO per-message directive part", async () => {
    params = { id: "session-1" }
    ultracodeSession = true
    promptValue = [{ type: "text", content: "fix the bug", start: 0, end: 11 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    expect(promptParts).toHaveLength(1)
    expect(promptParts[0].some((part) => part.synthetic)).toBe(false)
    const [first] = promptParts[0]
    expect(first).toMatchObject({ type: "text", text: "fix the bug" })
  })

  // Item 13: toggling before the first session keeps the flag local; the
  // submit path PATCHes session.metadata.ultracode onto the fresh session so
  // the very first prompt already runs with the server-side standing opt-in.
  test("a new session created while ultracode is on gets metadata.ultracode PATCHed", async () => {
    params = {}
    ultracodeSession = true
    promptValue = [{ type: "text", content: "fix the bug", start: 0, end: 11 }]
    const submit = createPromptSubmit({
      ...workflowInput(),
      info: () => undefined,
      newSessionWorktree: () => "main",
    })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual(["/repo/main"])
    expect(sessionUpdates).toEqual([
      { directory: "/repo/main", sessionID: "session-1", metadata: { ultracode: true } },
    ])
  })

  test("a new session with ultracode off is never PATCHed", async () => {
    params = {}
    promptValue = [{ type: "text", content: "fix the bug", start: 0, end: 11 }]
    const submit = createPromptSubmit({
      ...workflowInput(),
      info: () => undefined,
      newSessionWorktree: () => "main",
    })

    await submit.handleSubmit(event)
    await flush()

    expect(createdSessions).toEqual(["/repo/main"])
    expect(sessionUpdates).toEqual([])
  })

  test("strips the keyword from the visible part and sends the prompt directive as reminder part", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "ultracode fix the bug", start: 0, end: 21 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    const [first, second] = promptParts[0]
    expect(first).toMatchObject({ type: "text", synthetic: true })
    expect(first?.text).toStartWith("<system-reminder>")
    expect(first?.text).toContain("opted into workflow orchestration")
    // The directive legitimately mentions "(ultracode)"; the USER's visible
    // part carries the stripped text without the trigger word.
    expect(second?.synthetic).toBeUndefined()
    expect(second?.text).toBe("fix the bug")
    expect(second?.text).not.toMatch(/\bultracode\b/i)
  })

  test("does not inject when the config keyword flag is off and session mode is off", async () => {
    params = { id: "session-1" }
    keywordEnabled = false
    promptValue = [{ type: "text", content: "ultracode fix the bug", start: 0, end: 21 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    expect(promptParts[0].some((p) => p.synthetic)).toBe(false)
    const text = promptParts[0]
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("")
    expect(text).toContain("ultracode fix the bug")
    expect(text).not.toContain("opted into workflow orchestration")
  })

  test("strips a +$ budget directive and sends the confirmation as reminder part", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "+$5 do x", start: 0, end: 8 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    const [first, second] = promptParts[0]
    expect(first).toMatchObject({ type: "text", synthetic: true })
    expect(first?.text).toStartWith("<system-reminder>")
    expect(first?.text).toContain("cost budget of $5")
    // The visible user part carries the stripped text without the directive.
    expect(second?.synthetic).toBeUndefined()
    expect(second?.text).toBe("do x")
  })

  test("ultracode keyword and budget directive combine (both reminders, both strips)", async () => {
    params = { id: "session-1" }
    promptValue = [{ type: "text", content: "ultracode +$3 audit src/", start: 0, end: 24 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)

    await flush()

    const [first, second, third] = promptParts[0]
    expect(first?.text).toContain("opted into workflow orchestration")
    expect(second?.text).toContain("cost budget of $3")
    expect(third?.text).toBe("audit src/")
    expect(third?.synthetic).toBeUndefined()
  })

  test("queued drafts carry directives and the stripped prompt", async () => {
    params = { id: "session-1" }
    ultracodeSession = true
    promptValue = [{ type: "text", content: "ultracode fix the bug", start: 0, end: 21 }]
    const queued: FollowupDraft[] = []
    const submit = createPromptSubmit({
      ...workflowInput(),
      shouldQueue: () => true,
      onQueue: (draft) => queued.push(draft),
    })

    await submit.handleSubmit(event)

    await flush()

    // The turn is queued, not sent; the draft transports the directives so
    // sendFollowupDraft emits them later (pages/session.tsx followup path).
    // Item 13: only the keyword directive travels — session mode is server-side.
    expect(promptParts).toEqual([])
    expect(queued).toHaveLength(1)
    expect(queued[0]?.directives).toEqual([ULTRACODE_PROMPT_DIRECTIVE])
    expect(queued[0]?.prompt).toEqual([{ type: "text", content: "fix the bug", start: 0, end: 0 }])
  })
})

describe("direct /<name> workflow routing (Bonus A)", () => {
  test("a workflow-sourced /<name> starts a real run with parsed args and never calls session.command", async () => {
    params = { id: "session-1" }
    commandList = [{ name: "review", source: "workflow" }]
    workflowListData = [
      { name: "review", valid: true, meta: { name: "review", arguments: { count: { type: "number" } } } },
    ]
    promptValue = [{ type: "text", content: "/review count=2 tag=v1.0", start: 0, end: 24 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowStarts).toHaveLength(1)
    expect(workflowStarts[0]).toMatchObject({
      name: "review",
      directory: "/repo/main",
      args: { count: 2, tag: "v1.0" },
      permission: "session-1",
    })
    // The empty-template bug: session.command must never fire for a workflow.
    expect(sessionCommands).toEqual([])
    expect(promptParts).toEqual([])
    // approval:"never" (the test default) never opens the dialog.
    expect(workflowApprovalShown).toBe(0)
  })

  test("the approval gate applies to a direct /<name> start (cancel aborts)", async () => {
    params = { id: "session-1" }
    workflowApprovalMode = "first-run"
    workflowApprovalReply = "cancel"
    commandList = [{ name: "review", source: "workflow" }]
    workflowListData = [{ name: "review", valid: true, meta: { name: "review" } }]
    promptValue = [{ type: "text", content: "/review", start: 0, end: 7 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(workflowApprovalShown).toBe(1)
    expect(workflowStarts).toEqual([])
    expect(sessionCommands).toEqual([])
  })

  test("a command-sourced /<name> still executes session.command (commands win)", async () => {
    params = { id: "session-1" }
    commandList = [{ name: "review", source: "command" }]
    promptValue = [{ type: "text", content: "/review now", start: 0, end: 11 }]
    const submit = createPromptSubmit(workflowInput())

    await submit.handleSubmit(event)
    await flush()

    expect(sessionCommands).toEqual([{ directory: "/repo/main", command: "review", arguments: "now" }])
    expect(workflowStarts).toEqual([])
  })

  test("queued backstop: a workflow-sourced /<name> draft falls back to the plain prompt", async () => {
    commandList = [{ name: "review", source: "workflow" }]
    const sent = await sendFollowupDraft({
      client: clientFor("/repo/main") as any,
      serverSync: { child: () => [{}, () => undefined] } as any,
      sync: {
        data: { command: commandList },
        session: { optimistic: { add: () => undefined, remove: () => undefined } },
      } as any,
      draft: {
        sessionID: "session-1",
        sessionDirectory: "/repo/main",
        prompt: [{ type: "text", content: "/review k=v", start: 0, end: 11 }],
        context: [],
        agent: "agent",
        model: { providerID: "provider", modelID: "model" },
      },
    })

    // The draft is sent as a plain prompt (promptAsync), never as the
    // empty-template session.command.
    expect(sent).toBe(true)
    expect(sessionCommands).toEqual([])
    expect(promptParts).toHaveLength(1)
  })

  test("queued command-sourced drafts keep executing session.command", async () => {
    commandList = [{ name: "review", source: "command" }]
    const sent = await sendFollowupDraft({
      client: clientFor("/repo/main") as any,
      serverSync: { child: () => [{}, () => undefined] } as any,
      sync: {
        data: { command: commandList },
        session: { optimistic: { add: () => undefined, remove: () => undefined } },
      } as any,
      draft: {
        sessionID: "session-1",
        sessionDirectory: "/repo/main",
        prompt: [{ type: "text", content: "/review k=v", start: 0, end: 11 }],
        context: [],
        agent: "agent",
        model: { providerID: "provider", modelID: "model" },
      },
    })

    expect(sent).toBe(true)
    expect(sessionCommands).toEqual([{ directory: "/repo/main", command: "review", arguments: "k=v" }])
    expect(promptParts).toEqual([])
  })
})
