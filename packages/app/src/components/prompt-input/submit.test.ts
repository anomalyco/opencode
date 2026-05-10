import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { BrowserAnnotation } from "@/context/browser-types"
import type { Prompt } from "@/context/prompt"

let createPromptSubmit: typeof import("./submit").createPromptSubmit
let hasSubmittableInput: typeof import("./submit").hasSubmittableInput

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
const promptAsyncCalls: Array<{ directory: string; parts: unknown[] }> = []
const toasts: Array<{ title?: string; description?: string; variant?: string }> = []
const browserPanel: boolean[] = []
const browserNavigations: string[] = []
const browserCreated: Array<string | undefined> = []
const openBrowserPanelCalls: Array<string | undefined> = []
let config: { browser?: { integratedTools?: { enabled?: boolean } } } = {}

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined

let promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]

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
      promptAsync: async (input: { parts: unknown[] }) => {
        promptAsyncCalls.push({ directory, parts: input.parts })
        return { data: undefined }
      },
      command: async () => ({ data: undefined }),
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
    showToast: (input: { title?: string; description?: string; variant?: string }) => {
      toasts.push(input)
      return 0
    },
  }))

  mock.module("@/context/browser-actions", () => ({
    openBrowserPanel: async (input: {
      api?: {
        createBrowser?: (value?: { url?: string }) => Promise<{ browser: { id: string; title: string; url: string }; state: { activeBrowserId: string } }>
        navigate?: (url: string) => Promise<unknown>
      }
      browserStore: { store: { activeId: string | null; instances?: Record<string, { id: string; title: string; url: string; visible: boolean }> } }
      openPanel: () => void
      setPanelOpen: (open: boolean) => void
      url?: string
    }) => {
      openBrowserPanelCalls.push(input.url)
      input.openPanel()
      input.setPanelOpen(true)
      if (!input.api) return undefined
      const existingId = input.browserStore.store.activeId ?? Object.keys(input.browserStore.store.instances ?? {})[0]
      const created = existingId ? undefined : await input.api.createBrowser?.(input.url ? { url: input.url } : undefined)
      if (input.url && (!created || created.browser.url !== input.url)) await input.api.navigate?.(input.url)
      return existingId ?? created?.state.activeBrowserId ?? created?.browser.id
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

  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptValue,
      reset: () => undefined,
      set: () => undefined,
      context: {
        add: () => undefined,
        remove: () => undefined,
        items: () => [],
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
        createClient(opts: { directory: string; throwOnError?: boolean }) {
          return clientFor(opts.directory)
        },
      }
      return sdk
    },
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: [] },
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
      data: { config },
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
  hasSubmittableInput = mod.hasSubmittableInput
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
  promptAsyncCalls.length = 0
  toasts.length = 0
  browserPanel.length = 0
  browserNavigations.length = 0
  browserCreated.length = 0
  openBrowserPanelCalls.length = 0
  config = {}
  selected = "/repo/worktree-a"
  variant = undefined
  promptValue = [{ type: "text", content: "ls", start: 0, end: 2 }]
  for (const key of Object.keys(storedSessions)) delete storedSessions[key]
})

describe("local browser slash command", () => {
  const browserCommand = () => ({
    browser: {
      api: {
        createBrowser: async (input?: { url?: string }) => {
          browserCreated.push(input?.url)
          return {
            browser: { id: "browser-1", title: "Browser", url: input?.url ?? "about:blank" },
            state: { activeBrowserId: "browser-1", browsers: [] },
          }
        },
        navigate: async (url: string) => {
          browserNavigations.push(url)
          return { url, title: "" }
        },
      },
      store: {
        store: { activeId: null, instances: {} },
        addBrowser: () => undefined,
        setActiveBrowser: () => undefined,
        updateBrowser: () => undefined,
      },
      openPanel: () => browserPanel.push(true),
      setPanelOpen: (open: boolean) => browserPanel.push(open),
    },
  })

  test("opens and provisions the browser panel for raw /browser without sending a prompt", async () => {
    params = { id: "session-browser" }
    promptValue = [{ type: "text", content: "/browser", start: 0, end: 8 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      ...browserCommand(),
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(browserPanel).toEqual([true, true])
    expect(browserCreated).toEqual([undefined])
    expect(browserNavigations).toEqual([])
    expect(promptAsyncCalls).toEqual([])
    expect(createdSessions).toEqual([])
  })

  test("submits /browser task through the normal prompt path exactly once with task text preserved", async () => {
    params = { id: "session-browser" }
    promptValue = [{ type: "text", content: "/browser facebook.com", start: 0, end: 21 }]
    const submitted: boolean[] = []

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      onSubmit: () => submitted.push(true),
      ...browserCommand(),
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(submitted).toEqual([true])
    expect(browserPanel).toEqual([])
    expect(openBrowserPanelCalls).toEqual([])
    expect(browserCreated).toEqual([])
    expect(browserNavigations).toEqual([])
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.parts[0]).toMatchObject({ type: "text", text: "/browser facebook.com" })
    expect(
      promptAsyncCalls[0]?.parts.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "metadata" in part &&
          typeof part.metadata === "object" &&
          part.metadata !== null &&
          "opencodeBrowserTools" in part.metadata,
      ),
    ).toBe(true)
    expect(createdSessions).toEqual([])
  })

  test("submits /browser prose task without silently clearing it after local panel navigation", async () => {
    params = { id: "session-browser" }
    promptValue = [{ type: "text", content: "/browser abrir facebook.com y revisar login", start: 0, end: 42 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      ...browserCommand(),
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(browserPanel).toEqual([])
    expect(openBrowserPanelCalls).toEqual([])
    expect(browserCreated).toEqual([])
    expect(browserNavigations).toEqual([])
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.parts[0]).toMatchObject({
      type: "text",
      text: "/browser abrir facebook.com y revisar login",
    })
    expect(createdSessions).toEqual([])
  })

  test("submits arbitrary /browser task text instead of rejecting it as an invalid URL", async () => {
    params = { id: "session-browser" }
    promptValue = [{ type: "text", content: "/browser investigá facebook", start: 0, end: 27 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      ...browserCommand(),
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(toasts).toEqual([])
    expect(browserPanel).toEqual([])
    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.parts[0]).toMatchObject({ type: "text", text: "/browser investigá facebook" })
    expect(createdSessions).toEqual([])
  })

  test("submits /browser task with disabled-state browser hint when integrated tools are disabled", async () => {
    params = { id: "session-browser" }
    config = { browser: { integratedTools: { enabled: false } } }
    promptValue = [{ type: "text", content: "/browser inspect login", start: 0, end: 22 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      ...browserCommand(),
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const browserHint = promptAsyncCalls[0]?.parts.find(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "metadata" in part &&
        typeof part.metadata === "object" &&
        part.metadata !== null &&
        "opencodeBrowserTools" in part.metadata,
    ) as { text?: string; metadata?: { opencodeBrowserTools?: unknown } } | undefined

    expect(promptAsyncCalls).toHaveLength(1)
    expect(browserHint?.text).toContain("Integrated browser tools are disabled")
    expect(browserHint?.text).not.toContain("Integrated browser tools are available")
    expect(browserHint?.metadata?.opencodeBrowserTools).toEqual({ enabled: false, available: false })
  })

  test("submits /browser task with unavailable browser hint when the bridge API is missing", async () => {
    params = { id: "session-browser" }
    promptValue = [{ type: "text", content: "/browser inspect login", start: 0, end: 22 }]
    const target = browserCommand()

    const submit = createPromptSubmit({
      info: () => ({ id: "session-browser" }),
      imageAttachments: () => [],
      annotations: () => [],
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
      browser: { ...target.browser, api: undefined },
    })

    await submit.handleSubmit({ preventDefault: () => undefined } as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const browserHint = promptAsyncCalls[0]?.parts.find(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "metadata" in part &&
        typeof part.metadata === "object" &&
        part.metadata !== null &&
        "opencodeBrowserTools" in part.metadata,
    ) as { text?: string; metadata?: { opencodeBrowserTools?: unknown } } | undefined

    expect(promptAsyncCalls).toHaveLength(1)
    expect(browserHint?.text).toContain("Integrated browser tools are unavailable")
    expect(browserHint?.text).not.toContain("Integrated browser tools are available")
    expect(browserHint?.text).not.toContain("should be preferred over Playwright/external browsers")
    expect(browserHint?.metadata?.opencodeBrowserTools).toEqual({ enabled: true, available: false })
  })
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      annotations: () => [],
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
      annotations: () => [],
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
      annotations: () => [],
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
      annotations: () => [],
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

  test("submits annotations through the prompt request path even without text", async () => {
    params = { id: "session-annotations" }
    promptValue = [{ type: "text", content: "", start: 0, end: 0 }]

    const submit = createPromptSubmit({
      info: () => ({ id: "session-annotations" }),
      imageAttachments: () => [],
      annotations: () => [
        {
          id: "annotation-1",
          createdAt: 1,
          pageTitle: "Pricing",
          pageUrl: "https://opencode.ai/pricing",
          userComment: "Clarify the CTA",
          element: {
            selector: "button[data-testid='cta']",
            tagName: "button",
            role: "button",
            accessibleName: "Start free trial",
            visibleText: "Start free trial",
            attributes: {},
            boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          },
          preview: {},
          context: {
            nearbyDomSanitized: "Start free trial Compare plans",
          },
        } satisfies BrowserAnnotation,
      ],
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
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(promptAsyncCalls).toHaveLength(1)
    expect(promptAsyncCalls[0]?.directory).toBe("/repo/main")
    expect(
      promptAsyncCalls[0]?.parts.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "metadata" in part &&
          typeof part.metadata === "object" &&
          part.metadata !== null &&
          "opencodeAnnotations" in part.metadata,
      ),
    ).toBe(true)
  })

  test("clears annotations after a successful send", async () => {
    params = { id: "session-annotations" }
    promptValue = [{ type: "text", content: "review this", start: 0, end: 11 }]
    const cleared: string[] = []

    const submit = createPromptSubmit({
      info: () => ({ id: "session-annotations" }),
      imageAttachments: () => [],
      annotations: () => [
        {
          id: "annotation-1",
          createdAt: 1,
          pageTitle: "Pricing",
          pageUrl: "https://opencode.ai/pricing",
          userComment: "Clarify the CTA",
          element: {
            selector: "button[data-testid='cta']",
            tagName: "button",
            role: "button",
            accessibleName: "Start free trial",
            visibleText: "Start free trial",
            attributes: {},
            boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          },
          preview: {},
          context: {
            nearbyDomSanitized: "Start free trial Compare plans",
          },
        } satisfies BrowserAnnotation,
      ],
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
      clearAnnotations: () => {
        cleared.push("send")
      },
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(cleared).toEqual(["send"])
  })

  test("clears annotations after queueing a draft", async () => {
    params = { id: "session-queue" }
    promptValue = [{ type: "text", content: "review this", start: 0, end: 11 }]
    const cleared: string[] = []
    const queued: Array<{ annotations: BrowserAnnotation[] }> = []

    const submit = createPromptSubmit({
      info: () => ({ id: "session-queue" }),
      imageAttachments: () => [],
      annotations: () => [
        {
          id: "annotation-1",
          createdAt: 1,
          pageTitle: "Pricing",
          pageUrl: "https://opencode.ai/pricing",
          userComment: "Clarify the CTA",
          element: {
            selector: "button[data-testid='cta']",
            tagName: "button",
            role: "button",
            accessibleName: "Start free trial",
            visibleText: "Start free trial",
            attributes: {},
            boundingBox: { x: 10, y: 20, width: 200, height: 44 },
          },
          preview: {},
          context: {
            nearbyDomSanitized: "Start free trial Compare plans",
          },
        } satisfies BrowserAnnotation,
      ],
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
      shouldQueue: () => true,
      onQueue: (draft) => {
        queued.push({ annotations: draft.annotations })
      },
      clearAnnotations: () => {
        cleared.push("queue")
      },
      onSubmit: () => undefined,
    })

    const event = { preventDefault: () => undefined } as unknown as Event

    await submit.handleSubmit(event)

    expect(queued).toHaveLength(1)
    expect(queued[0]?.annotations).toHaveLength(1)
    expect(cleared).toEqual(["queue"])
  })

  test("treats annotation-only input as submittable while working", () => {
    expect(
      hasSubmittableInput({
        text: "   ",
        images: [],
        annotations: [
          {
            id: "annotation-1",
            createdAt: 1,
            pageTitle: "Pricing",
            pageUrl: "https://opencode.ai/pricing",
            userComment: "Clarify the CTA",
            element: {
              selector: "button[data-testid='cta']",
              tagName: "button",
              role: "button",
              accessibleName: "Start free trial",
              visibleText: "Start free trial",
              attributes: {},
              boundingBox: { x: 10, y: 20, width: 200, height: 44 },
            },
            preview: {},
            context: {},
          } satisfies BrowserAnnotation,
        ],
        commentCount: 0,
      }),
    ).toBe(true)
  })
})
