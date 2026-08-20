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
const childID = "ses_smoke_child"
const directory = "C:/OpenCode/SmokeProject"
const projectID = "proj_smoke_timeline"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type MessagePart = {
  id: string
  type: "text" | "reasoning" | "tool"
  text?: string
  time?: { start: number; end?: number }
  callID?: string
  tool?: string
  state?: {
    status: "completed"
    input: Record<string, unknown>
    output: string
    title: unknown
    metadata: Record<string, unknown>
    time: { start: number; end: number }
  }
}

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

function userMessage(_sessionID: string, index: number, textLength: number, diffs: unknown[] = []): SessionMessageInfo {
  const messageID = id("msg_user", index)
  return {
    id: messageID,
    type: "user",
    time: { created: 1700000000000 + index * 10_000 },
    text: lorem(index, textLength),
    metadata: diffs.length ? { diffs: diffs as JsonValue } : undefined,
  }
}

function assistantMessage(
  _sessionID: string,
  index: number,
  _parentID: string,
  parts: MessagePart[],
): SessionMessageInfo {
  const messageID = id("msg_assistant", index)
  return {
    id: messageID,
    type: "assistant",
    time: { created: 1700000000000 + index * 10_000 + 1_000, completed: 1700000000000 + index * 10_000 + 8_000 },
    model: { id: model.modelID, providerID: model.providerID, variant: model.variant },
    agent: "build",
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
    content: parts.map(messageContent),
  }
}

function messageContent(part: MessagePart): SessionMessageAssistant["content"][number] {
  if (part.type === "text") return { type: "text", text: part.text ?? "" }
  if (part.type === "reasoning")
    return {
      type: "reasoning",
      text: part.text ?? "",
      time: part.time
        ? { created: part.time.start, ...(part.time.end === undefined ? {} : { completed: part.time.end }) }
        : undefined,
    }
  const state = part.state!
  return {
    type: "tool",
    id: part.callID ?? part.id,
    name: part.tool!,
    time: { created: state.time.start, ran: state.time.start, completed: state.time.end },
    state: {
      status: "completed",
      input: state.input as Record<string, JsonValue>,
      content: [{ type: "text", text: state.output }],
      metadata: state.metadata as Record<string, JsonValue>,
    },
  }
}

function textPart(index: number, partIndex: number, length: number): MessagePart {
  const prose = lorem(index * 13 + partIndex, length)
  const text =
    index % 12 === 0
      ? `${prose}\n\n\`\`\`ts\n${code(index, 80)}\n\`\`\``
      : index % 5 === 0
        ? `${prose}\n\n\`\`\`ts\nexport const value = "${lorem(index, 220)}"\n\`\`\``
        : index % 7 === 0
          ? `${prose}\n\nThe wrapped inline value is \`${lorem(index, 180)}\`.`
          : prose
  return { id: id(`prt_text_${partIndex}`, index), type: "text", text }
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
  metadataOverride?: Record<string, unknown>,
): MessagePart {
  const metadata =
    metadataOverride ??
    (tool === "apply_patch"
      ? { files: [patchFile(index, "update"), patchFile(index + 1, index % 2 === 0 ? "add" : "delete")] }
      : tool === "edit" || tool === "write"
        ? {
            filediff: fileDiff(String(input.filePath ?? `src/generated/file-${index}.ts`), index),
            diff: patch(index, outputLength),
            preview: patch(index + 1, 420),
          }
        : tool === "question"
          ? { answers: [["Proceed"], ["Keep sample output"]] }
          : {})
  return {
    id: id(`prt_tool_${tool}_${partIndex}`, index),
    type: "tool",
    callID: id("call", index * 10 + partIndex),
    tool,
    state: {
      status: "completed",
      input,
      output: lorem(index * 23 + partIndex, outputLength),
      title: tool === "bash" ? "Verify generated output" : input.filePath || input.path || input.pattern || "completed",
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
  const lines = seed % 12 === 0 ? 300 : seed % 8 === 0 ? 2 : 38
  const before = code(seed, lines, seed % 10 === 0 ? 280 : 32)
  const after =
    lines === 2
      ? before.replace("value1", "updatedValue1")
      : lines === 300
        ? code(seed + 1, lines, seed % 10 === 0 ? 280 : 32)
        : before.replace("value4", "updatedValue4").replace("value20", "updatedValue20")
  return {
    file,
    additions: lines === 300 ? 300 : lines === 2 ? 1 : 2,
    deletions: lines === 300 ? 300 : lines === 2 ? 1 : 2,
    before,
    after,
  }
}

function patch(seed: number, length: number) {
  return `diff --git a/src/generated/file-${seed}.ts b/src/generated/file-${seed}.ts\n+${lorem(seed, length).replace(/\n/g, "\n+")}`
}

function code(seed: number, lines: number, width = 32) {
  return Array.from(
    { length: lines },
    (_, index) => `export const value${index} = "${lorem(seed + index, width)}"`,
  ).join("\n")
}

function turn(index: number): SessionMessageInfo[] {
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
      ? [toolPart(index, 4, "bash", { command: "bun typecheck", description: "Verify generated output" }, 620)]
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
  return [user, assistantMessage(targetID, index, user.id, parts)]
}

const targetMessages = Array.from({ length: 72 }, (_, index) => turn(index)).flat()
const sourceMessages = Array.from({ length: 12 }, (_, index) => [
  userMessage(sourceID, index + 1000, 120),
  assistantMessage(sourceID, index + 1000, id("msg_user", index + 1000), [
    textPart(index + 1000, 0, 240),
    ...(index === 11
      ? [
          toolPart(
            index + 1000,
            1,
            "task",
            { description: "Inspect child navigation", subagent_type: "explore" },
            160,
            { sessionId: childID },
          ),
        ]
      : []),
  ]),
]).flat()
const childMessages = Array.from({ length: 4 }, (_, index) => [
  userMessage(childID, index + 2000, 120),
  assistantMessage(childID, index + 2000, id("msg_user", index + 2000), [textPart(index + 2000, 0, 240)]),
]).flat()
const messages: Record<string, SessionMessageInfo[]> = {
  [sourceID]: sourceMessages,
  [targetID]: targetMessages,
  [childID]: childMessages,
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
    {
      id: childID,
      parentID: sourceID,
      slug: "child",
      projectID,
      directory,
      title: "Inspect child navigation",
      version: "dev",
      time: { created: 1700000002000, updated: 1700000002000 },
    },
  ],
  sourceID,
  targetID,
  childID,
  messages,
  expected: {
    sourceTitle: "Uncommitted changes inquiry",
    targetTitle: "Example Game: sample jump movement & sample physics analysis",
    childTitle: "Inspect child navigation",
    sourceMessageIDs: sourceMessages.filter((message) => message.type === "user").map((message) => message.id),
    targetMessageIDs: targetMessages.filter((message) => message.type === "user").map((message) => message.id),
    childMessageIDs: childMessages.filter((message) => message.type === "user").map((message) => message.id),
    targetPartIDs: targetMessages.flatMap((message) => {
      if (message.type !== "assistant") return []
      const ordinals = { text: 0, reasoning: 0 }
      return message.content.flatMap((part) => {
        if (part.type === "text") return part.text.trim() ? [`${message.id}:text:${ordinals.text++}`] : []
        if (part.type === "reasoning")
          return part.text.trim() ? [`${message.id}:reasoning:${ordinals.reasoning++}`] : []
        return [part.id]
      })
    }),
  },
}

export function pageMessages(sessionID: string, limit: number, before?: string) {
  const messages = fixture.messages[sessionID] ?? []
  const end = before
    ? Math.max(
        0,
        messages.findIndex((message) => message.id === before),
      )
    : messages.length
  const start = Math.max(0, end - limit)
  return {
    items: messages.slice(start, end),
    cursor: start > 0 ? messages[start].id : undefined,
  }
}
import type { JsonValue, SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
