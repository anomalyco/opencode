const words = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "metro",
  "nova",
  "orbit",
  "pixel",
  "quartz",
  "river",
  "signal",
  "vector",
]

const sourceID = "ses_smoke_source"
const targetID = "ses_smoke_target"
const directory = "C:/OpenCode/SmokeProject"
const projectID = "proj_smoke_timeline"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type MessageInfo = Record<string, unknown> & { id: string; role: "user" | "assistant" }
type MessagePart = Record<string, unknown> & { id: string; type: string; text?: string; tool?: string }
type Message = { info: MessageInfo; parts: MessagePart[] }

function lorem(seed: number, length: number) {
  let out = ""
  let i = seed
  while (out.length < length) {
    const word = words[i % words.length]
    out += (out ? " " : "") + word
    if (i % 17 === 0) out += ".\n\n"
    i += 7
  }
  return out.slice(0, length)
}

function id(prefix: string, value: number) {
  return `${prefix}_smoke_${String(value).padStart(4, "0")}`
}

function userMessage(sessionID: string, index: number, textLength: number, diffs: unknown[] = []): Message {
  const messageID = id("msg_user", index)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 1700000000000 + index * 10_000 },
      summary: { diffs },
      agent: "build",
      model,
    },
    parts: [
      {
        id: id("prt_user_text", index),
        sessionID,
        messageID,
        type: "text",
        text: lorem(index, textLength),
      },
    ],
  }
}

function assistantMessage(sessionID: string, index: number, parentID: string, parts: MessagePart[]): Message {
  const messageID = id("msg_assistant", index)
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: { created: 1700000000000 + index * 10_000 + 1_000, completed: 1700000000000 + index * 10_000 + 8_000 },
      parentID,
      modelID: model.modelID,
      providerID: model.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: directory, root: directory },
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      variant: "max",
      finish: "stop",
    },
    parts: parts.map((part) => ({
      ...part,
      sessionID,
      messageID,
    })),
  }
}

function textPart(index: number, partIndex: number, length: number): MessagePart {
  return { id: id(`prt_text_${partIndex}`, index), type: "text", text: lorem(index * 13 + partIndex, length) }
}

function reasoningPart(index: number, partIndex: number, length: number): MessagePart {
  return {
    id: id(`prt_reasoning_${partIndex}`, index),
    type: "reasoning",
    text: lorem(index * 19 + partIndex, length),
    time: { start: 1700000000000 + index * 10_000, end: 1700000000000 + index * 10_000 + 500 },
  }
}

function toolPart(
  index: number,
  partIndex: number,
  tool: string,
  input: Record<string, unknown>,
  outputLength = 160,
): MessagePart {
  const metadata =
    tool === "apply_patch"
      ? { files: [patchFile(index, "update"), patchFile(index + 1, index % 2 === 0 ? "add" : "delete")] }
      : tool === "edit" || tool === "write"
        ? {
            filediff: fileDiff(String(input.filePath ?? `src/generated/file-${index}.ts`), index),
            diff: patch(index, outputLength),
            preview: patch(index + 1, 420),
          }
        : tool === "question"
          ? { answers: [["Proceed"], ["Keep sample output"]] }
          : {}
  return {
    id: id(`prt_tool_${tool}_${partIndex}`, index),
    type: "tool",
    callID: id("call", index * 10 + partIndex),
    tool,
    state: {
      status: "completed",
      input,
      output: lorem(index * 23 + partIndex, outputLength),
      title: tool === "bash" ? input.command : input.filePath || input.path || input.pattern || "completed",
      metadata,
      time: { start: 1700000000000 + index * 10_000, end: 1700000000000 + index * 10_000 + 400 },
    },
  }
}

function patchFile(seed: number, type: "add" | "update" | "delete") {
  return {
    filePath: `src/generated/patch-${seed}.ts`,
    relativePath: `src/generated/patch-${seed}.ts`,
    type,
    additions: (seed % 7) + 1,
    deletions: type === "add" ? 0 : seed % 4,
    patch: patch(seed, 520),
    before: type === "add" ? undefined : code(seed, 18),
    after: type === "delete" ? undefined : code(seed + 1, 24),
  }
}

function fileDiff(file: string, seed: number) {
  return {
    file,
    additions: (seed % 9) + 1,
    deletions: seed % 4,
    before: code(seed, 32),
    after: code(seed + 1, 38),
  }
}

function patch(seed: number, length: number) {
  return `diff --git a/src/generated/file-${seed}.ts b/src/generated/file-${seed}.ts\n+${lorem(seed, length).replace(/\n/g, "\n+")}`
}

function code(seed: number, lines: number) {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = "${lorem(seed + index, 32)}"`).join(
    "\n",
  )
}

function turn(index: number): Message[] {
  const diff = index % 9 === 0 ? [fileDiff(`src/generated/summary-${index}.ts`, index)] : []
  const user = userMessage(targetID, index, 100 + (index % 4) * 80, diff)
  const parts = [
    ...(index % 5 === 0 ? [reasoningPart(index, 0, 420)] : []),
    ...(index % 3 === 0
      ? [
          toolPart(index, 0, "read", { filePath: `src/generated/file-${index}.ts`, offset: 0, limit: 80 }, 220),
          toolPart(index, 5, "glob", { path: directory, pattern: `**/*sample-${index}*.ts` }, 140),
          toolPart(index, 1, "grep", { path: directory, pattern: `sample-${index}`, include: "*.ts" }, 180),
          toolPart(index, 6, "list", { path: `src/generated/${index}` }, 120),
        ]
      : []),
    textPart(index, 2, 160 + (index % 6) * 90),
    ...(index % 4 === 0 ? [toolPart(index, 3, "edit", { filePath: `src/generated/file-${index}.ts` }, 700)] : []),
    ...(index % 6 === 0
      ? [toolPart(index, 7, "write", { filePath: `src/generated/write-${index}.ts`, content: code(index, 28) }, 560)]
      : []),
    ...(index % 8 === 0
      ? [toolPart(index, 8, "apply_patch", { files: [`src/generated/patch-${index}.ts`] }, 620)]
      : []),
    ...(index % 7 === 0
      ? [toolPart(index, 4, "bash", { command: "bun typecheck" }, 620)]
      : []),
    ...(index % 10 === 0 ? [toolPart(index, 9, "webfetch", { url: "https://example.com/docs/sample" }, 120)] : []),
    ...(index % 11 === 0 ? [toolPart(index, 10, "websearch", { query: "sample movement notes" }, 240)] : []),
    ...(index % 13 === 0
      ? [
          toolPart(
            index,
            11,
            "question",
            { questions: [{ question: "Use generated fixture?" }, { question: "Keep same row shape?" }] },
            120,
          ),
        ]
      : []),
    ...(index % 17 === 0
      ? [toolPart(index, 12, "task", { description: "Inspect generated fixture", subagent_type: "explore" }, 160)]
      : []),
  ]
  return [user, assistantMessage(targetID, index, user.info.id, parts)]
}

const targetMessages = Array.from({ length: 72 }, (_, index) => turn(index)).flat()
const sourceMessages = Array.from({ length: 12 }, (_, index) => [
  userMessage(sourceID, index + 1000, 120),
  assistantMessage(sourceID, index + 1000, id("msg_user", index + 1000), [textPart(index + 1000, 0, 240)]),
]).flat()

function renderable(part: MessagePart) {
  if (part.type === "tool" && part.tool === "todowrite") return false
  if (part.type === "text") return !!part.text.trim()
  if (part.type === "reasoning") return !!part.text.trim()
  return part.type !== "step-start" && part.type !== "step-finish" && part.type !== "patch"
}

function orderedParts(message: Message) {
  return message.parts.slice().sort((a, b) => a.id.localeCompare(b.id))
}

export const fixture = {
  directory,
  project: {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "smoke-project",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  },
  sessions: [
    {
      id: sourceID,
      slug: "source",
      projectID,
      directory,
      title: "Uncommitted changes inquiry",
      version: "dev",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    {
      id: targetID,
      slug: "target",
      projectID,
      directory,
      title: "Example Game: sample jump movement & sample physics analysis",
      version: "dev",
      time: { created: 1700000001000, updated: 1700000001000 },
    },
  ],
  sourceID,
  targetID,
  messages: { [sourceID]: sourceMessages, [targetID]: targetMessages },
  expected: {
    sourceTitle: "Uncommitted changes inquiry",
    targetTitle: "Example Game: sample jump movement & sample physics analysis",
    targetMessageIDs: targetMessages
      .filter((message) => message.info.role === "user")
      .map((message) => message.info.id),
    targetPartIDs: targetMessages.flatMap((message) =>
      orderedParts(message)
        .filter(renderable)
        .map((part) => part.id),
    ),
    expandedShellPartID: targetMessages.flatMap((message) => message.parts).find((part) => part.tool === "bash")!.id,
  },
}

export function pageMessages(sessionID: string, limit: number, before?: string) {
  const messages = fixture.messages[sessionID as keyof typeof fixture.messages] ?? []
  const end = before
    ? Math.max(
        0,
        messages.findIndex((message) => message.info.id === before),
      )
    : messages.length
  const start = Math.max(0, end - limit)
  return {
    items: messages.slice(start, end),
    cursor: start > 0 ? messages[start]!.info.id : undefined,
  }
}
