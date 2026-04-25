import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import type { Prompt } from "@/context/prompt"
import { exportMessageFeedback } from "@/utils/message-feedback"

let createPromptSubmit: typeof import("./submit").createPromptSubmit

type FileItem = {
  type: "file"
  path: string
  selection?: {
    startLine: number
    startChar: number
    endLine: number
    endChar: number
  }
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
  key?: string
}

type MessageItem = {
  type: "message"
  annotationID: string
  messageID: string
  role: Message["role"]
  quote: string
  comment?: string
  preview?: string
  key?: string
}

type Item = FileItem | MessageItem
type Entry = (FileItem | MessageItem) & { key: string }

type PromptCall = {
  directory: string
  input: {
    sessionID: string
    agent: string
    model: { providerID: string; modelID: string }
    messageID: string
    variant?: string
    parts: Array<{
      id?: string
      type: "text" | "file" | "agent"
      text?: string
      synthetic?: boolean
      metadata?: { opencodeComment?: { comment?: string } }
      url?: string
      filename?: string
      name?: string
    }>
  }
}

type CommandCall = {
  directory: string
  input: {
    sessionID: string
    command: string
  }
}

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
const prompts: PromptCall[] = []
const commands: CommandCall[] = []

let params: { id?: string } = {}
let selected = "/repo/worktree-a"
let variant: string | undefined
let model: { id: string; provider: { id: string } } | undefined
let agent: { name: string } | undefined

const promptValue: Prompt = [{ type: "text", content: "ls", start: 0, end: 2 }]

const join = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")
const len = (prompt: Prompt) => prompt.reduce((sum, part) => sum + ("content" in part ? part.content.length : 0), 0)
const event = () => ({ preventDefault: () => undefined }) as unknown as Event
const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const clonePrompt = (prompt: Prompt): Prompt =>
  prompt.map((part) => {
    if (part.type === "text") return { ...part }
    if (part.type === "image") return { ...part }
    if (part.type === "agent") return { ...part }
    return {
      ...part,
      selection: part.selection ? { ...part.selection } : undefined,
    }
  })

const cloneItem = (item: Entry): Entry => {
  if (item.type === "message") return { ...item }
  return {
    ...item,
    selection: item.selection ? { ...item.selection } : undefined,
  }
}

const key = (item: Item, i: number) => {
  if (item.type === "message") return `message:${item.annotationID}`
  return `file:${item.path}:${item.commentID ?? i}`
}

const withKey = (item: Item, i: number): Entry => {
  if (item.type === "message") return { ...item, key: item.key ?? key(item, i) }
  return {
    ...item,
    key: item.key ?? key(item, i),
    selection: item.selection ? { ...item.selection } : undefined,
  }
}

function createPromptState(input: { prompt?: Prompt; items?: Item[] } = {}) {
  let prompt = clonePrompt(input.prompt ?? promptValue)
  let items = (input.items ?? []).map(withKey)

  return {
    current: () => clonePrompt(prompt),
    reset: () => {
      prompt = [{ type: "text", content: "", start: 0, end: 0 }]
    },
    set: (next: Prompt) => {
      prompt = clonePrompt(next)
    },
    context: {
      add: (item: Item) => {
        const entry = withKey(item, items.length)
        if (items.find((x) => x.key === entry.key)) return
        items = [...items, entry]
      },
      remove: (value: string) => {
        items = items.filter((item) => item.key !== value)
      },
      replaceMessages: (next: MessageItem[]) => {
        items = [...items.filter((item) => item.type !== "message"), ...next.map(withKey)]
      },
      items: () => items.map(cloneItem),
    },
  }
}

let prompt = createPromptState()

const setupPrompt = (input: { prompt?: Prompt; items?: Item[] } = {}) => {
  prompt = createPromptState(input)
}

const countComments = () => prompt.context.items().filter((item) => !!item.comment?.trim()).length

const createSubmit = (input: Partial<Parameters<typeof createPromptSubmit>[0]> = {}) =>
  createPromptSubmit({
    info: () => ({ id: "session-1" }),
    imageAttachments: () => [],
    commentCount: countComments,
    autoAccept: () => false,
    mode: () => "normal",
    working: () => false,
    editor: () => undefined,
    queueScroll: () => undefined,
    promptLength: len,
    addToHistory: () => undefined,
    resetHistoryNavigation: () => undefined,
    setMode: () => undefined,
    setPopover: () => undefined,
    onSubmit: () => undefined,
    ...input,
  })

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
      promptAsync: async (input: PromptCall["input"]) => {
        prompts.push({ directory, input })
        return { data: undefined }
      },
      command: async (input: CommandCall["input"]) => {
        commands.push({ directory, input })
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
        current: () => model,
        variant: { current: () => variant },
      },
      agent: {
        current: () => agent,
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
    useSDK: () => ({
      directory: "/repo/main",
      client: rootClient,
      url: "http://localhost:4096",
      createClient(opts: { directory: string }) {
        return clientFor(opts.directory)
      },
    }),
  }))

  mock.module("@/context/sync", () => ({
    useSync: () => ({
      data: { command: [] },
      session: {
        optimistic: {
          add: (value: {
            directory?: string
            sessionID?: string
            message: { agent: string; model: { providerID: string; modelID: string }; variant?: string }
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

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (value: string) => value,
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
  syncedDirectories.length = 0
  prompts.length = 0
  commands.length = 0
  selected = "/repo/worktree-a"
  variant = undefined
  model = { id: "model", provider: { id: "provider" } }
  agent = { name: "agent" }
  document.body.innerHTML = ""
  setupPrompt()
  for (const value of Object.keys(storedSessions)) delete storedSessions[value]
})

describe("prompt submit worktree selection", () => {
  test("reads the latest worktree accessor value per submit", async () => {
    setupPrompt()

    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: countComments,
      autoAccept: () => false,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: len,
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit(event())
    selected = "/repo/worktree-b"
    prompt.set(promptValue)
    await submit.handleSubmit(event())

    expect(createdClients).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(createdSessions).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(sentShell).toEqual(["/repo/worktree-a", "/repo/worktree-b"])
    expect(syncedDirectories).toEqual(["/repo/worktree-a", "/repo/worktree-a", "/repo/worktree-b", "/repo/worktree-b"])
    expect(promoted).toEqual([
      { directory: "/repo/worktree-a", sessionID: "session-1" },
      { directory: "/repo/worktree-b", sessionID: "session-2" },
    ])
  })

  test("applies auto-accept to newly created sessions", async () => {
    setupPrompt()

    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: countComments,
      autoAccept: () => true,
      mode: () => "shell",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: len,
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit(event())

    expect(enabledAutoAccept).toEqual([{ sessionID: "session-1", directory: "/repo/worktree-a" }])
  })

  test("includes the selected variant on optimistic prompts", async () => {
    params = { id: "session-1" }
    variant = "high"
    setupPrompt()

    const submit = createSubmit()

    await submit.handleSubmit(event())
    await tick()

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      message: {
        agent: "agent",
        model: { providerID: "provider", modelID: "model" },
        variant: "high",
      },
    })
  })

  test("seeds new sessions before optimistic prompts are added", async () => {
    setupPrompt()

    const submit = createPromptSubmit({
      info: () => undefined,
      imageAttachments: () => [],
      commentCount: countComments,
      autoAccept: () => false,
      mode: () => "normal",
      working: () => false,
      editor: () => undefined,
      queueScroll: () => undefined,
      promptLength: len,
      addToHistory: () => undefined,
      resetHistoryNavigation: () => undefined,
      setMode: () => undefined,
      setPopover: () => undefined,
      newSessionWorktree: () => selected,
      onNewSessionWorktreeReset: () => undefined,
      onSubmit: () => undefined,
    })

    await submit.handleSubmit(event())

    expect(storedSessions["/repo/worktree-a"]).toEqual([{ id: "session-1", title: "New session 1" }])
    expect(optimisticSeeded).toEqual([true])
  })
})

describe("message annotation export", () => {
  test("sends file-comment-only drafts even when the text prompt is blank", async () => {
    params = { id: "session-1" }
    setupPrompt({
      prompt: [{ type: "text", content: "", start: 0, end: 0 }],
      items: [
        {
          type: "file",
          path: "src/app.ts",
          comment: "Check this file too",
          commentID: "comment-1",
          commentOrigin: "review",
          selection: { startLine: 7, startChar: 0, endLine: 9, endChar: 0 },
          preview: "src/app.ts:7-9",
        },
      ],
    })

    const onSubmit = mock(() => undefined)
    const submit = createSubmit({ onSubmit })

    await submit.handleSubmit(event())
    await tick()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(1)
    expect(commands).toHaveLength(0)
    expect(prompt.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])

    const sent = prompts[0].input.parts
    expect(sent[0]).toMatchObject({ type: "text", text: "" })
    expect(sent.find((part) => part.type === "text" && !!part.synthetic)?.metadata?.opencodeComment?.comment).toBe(
      "Check this file too",
    )
    expect(sent.some((part) => part.type === "file" && part.url?.startsWith("file:///repo/main/src/app.ts"))).toBe(true)
  })

  test("sends image-only drafts even when the text prompt is blank", async () => {
    params = { id: "session-1" }
    const image = {
      type: "image" as const,
      id: "img-1",
      filename: "shot.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,abc",
    }
    setupPrompt({
      prompt: [{ type: "text", content: "", start: 0, end: 0 }, image],
    })

    const onSubmit = mock(() => undefined)
    const submit = createSubmit({
      imageAttachments: () => [image],
      onSubmit,
    })

    await submit.handleSubmit(event())
    await tick()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(1)
    expect(commands).toHaveLength(0)
    expect(prompt.current()).toEqual([{ type: "text", content: "", start: 0, end: 0 }])

    const sent = prompts[0].input.parts
    expect(sent[0]).toMatchObject({ type: "text", text: "" })
    expect(sent.some((part) => part.type === "file" && part.url === "data:image/png;base64,abc")).toBe(true)
  })

  test("exports pending message annotations into the draft on first click only", async () => {
    params = { id: "session-1" }
    setupPrompt({
      prompt: [{ type: "text", content: "Draft", start: 0, end: 5 }],
      items: [
        {
          type: "message",
          annotationID: "ann-1",
          messageID: "msg-1",
          role: "assistant",
          quote: "Look here",
          comment: "Use this detail",
          preview: "Look here",
        },
        {
          type: "file",
          path: "src/app.ts",
          comment: "Keep this file note",
          commentID: "comment-1",
          commentOrigin: "file",
          selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 0 },
        },
      ],
    })

    const addToHistory = mock(() => undefined)
    const onSubmit = mock(() => undefined)
    const queueScroll = mock(() => undefined)
    const editor = document.createElement("div")
    editor.contentEditable = "true"
    editor.textContent = "Draft"
    document.body.append(editor)

    const submit = createSubmit({
      addToHistory,
      onSubmit,
      editor: () => editor,
      queueScroll,
    })

    await submit.handleSubmit(event())
    await frame()

    const md = exportMessageFeedback([
      {
        role: "assistant",
        quote: "Look here",
        comment: "Use this detail",
      },
    ])

    expect(join(prompt.current())).toBe(`Draft\n\n${md}`)
    expect(prompt.current()[0]).toMatchObject({ type: "text", content: "Draft" })
    expect(prompt.current().at(-1)).toMatchObject({ type: "text", content: `\n\n${md}` })
    expect(prompt.context.items().filter((item) => item.type === "message")).toHaveLength(0)
    expect(prompt.context.items()).toEqual([
      expect.objectContaining({
        type: "file",
        path: "src/app.ts",
        comment: "Keep this file note",
        commentID: "comment-1",
        commentOrigin: "file",
        selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 0 },
      }),
    ])
    expect(addToHistory).toHaveBeenCalledTimes(0)
    expect(onSubmit).toHaveBeenCalledTimes(0)
    expect(queueScroll).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(editor)
    expect(prompts).toHaveLength(0)
    expect(commands).toHaveLength(0)
    expect(createdSessions).toHaveLength(0)
    expect(optimistic).toHaveLength(0)
  })

  test("sends on the second click and keeps file comments on the synthetic path", async () => {
    params = { id: "session-1" }
    setupPrompt({
      prompt: [{ type: "text", content: "Draft", start: 0, end: 5 }],
      items: [
        {
          type: "message",
          annotationID: "ann-1",
          messageID: "msg-1",
          role: "user",
          quote: "Please fix this",
          comment: "Address this first",
          preview: "Please fix this",
        },
        {
          type: "file",
          path: "src/app.ts",
          comment: "Check this file too",
          commentID: "comment-1",
          commentOrigin: "review",
          selection: { startLine: 7, startChar: 0, endLine: 9, endChar: 0 },
          preview: "src/app.ts:7-9",
        },
      ],
    })

    const addToHistory = mock(() => undefined)
    const onSubmit = mock(() => undefined)
    const submit = createSubmit({ addToHistory, onSubmit })

    await submit.handleSubmit(event())
    await tick()

    expect(prompts).toHaveLength(0)
    expect(prompt.context.items()).toEqual([
      expect.objectContaining({
        type: "file",
        path: "src/app.ts",
        comment: "Check this file too",
        commentID: "comment-1",
        commentOrigin: "review",
        selection: { startLine: 7, startChar: 0, endLine: 9, endChar: 0 },
      }),
    ])

    const expanded = join(prompt.current())
    expect(expanded).toContain("# Conversation Feedback")

    await submit.handleSubmit(event())
    await tick()

    expect(addToHistory).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(1)
    expect(commands).toHaveLength(0)

    const sent = prompts[0].input.parts
    const head = sent[0]
    expect(head?.type).toBe("text")
    if (head?.type === "text") {
      expect(head.text).toBe(expanded)
    }

    const note = sent.find((part) => part.type === "text" && !!part.synthetic)
    expect(note).toBeDefined()
    expect(note?.metadata?.opencodeComment?.comment).toBe("Check this file too")
    expect(sent.some((part) => part.type === "file" && part.url?.startsWith("file:///repo/main/src/app.ts"))).toBe(true)
  })
})
