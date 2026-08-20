import { createTwoFilesPatch } from "diff"

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

const serverKey = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const sourceID = "ses_smoke_source"
const targetID = "ses_smoke_target"
const directory = "C:/OpenCode/SmokeProject"
const projectID = "proj_smoke_timeline"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

type MessagePart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "reasoning"; text: string; time?: { start: number; end?: number } }
  | {
      id: string
      type: "tool"
      name: string
      state: {
        status: "completed"
        input: Record<string, unknown>
        content: [{ type: "text"; text: string }]
        metadata: Record<string, unknown>
      }
      time: { created: number; ran: number; completed: number }
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
  return {
    type: "tool",
    id: part.id,
    name: part.name,
    time: part.time,
    state: {
      status: "completed",
      input: part.state.input as Record<string, JsonValue>,
      content: part.state.content,
      metadata: part.state.metadata as Record<string, JsonValue>,
    },
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
    tool === "patch"
      ? {
          files: [
            patchFile(index, "modified"),
            patchFile(index + 1, index % 2 === 0 ? "added" : "deleted"),
          ],
        }
      : tool === "edit" || tool === "write"
        ? { files: [fileDiff(String(input.path ?? `src/generated/file-${index}.ts`), index)] }
        : tool === "question"
          ? { answers: [["Proceed"], ["Keep sample output"]] }
          : {}
  return {
    id: id(`call_${tool}_${partIndex}`, index),
    type: "tool",
    name: tool,
    state: {
      status: "completed",
      input,
      content: [{ type: "text", text: lorem(index * 23 + partIndex, outputLength) }],
      metadata,
    },
    time: {
      created: 1700000000000 + index * 10_000,
      ran: 1700000000000 + index * 10_000,
      completed: 1700000000000 + index * 10_000 + 400,
    },
  }
}

function patchFile(seed: number, status: "added" | "modified" | "deleted") {
  const file = `src/generated/patch-${seed}.ts`
  const before = status === "added" ? "" : code(seed, 18)
  const after = status === "deleted" ? "" : code(seed + 1, 24)
  return {
    file,
    status,
    additions: status === "deleted" ? 0 : (seed % 7) + 1,
    deletions: status === "added" ? 0 : seed % 4,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
  }
}

function fileDiff(file: string, seed: number) {
  const before = code(seed, 32)
  const after = code(seed + 1, 38)
  return {
    file,
    status: "modified" as const,
    additions: (seed % 9) + 1,
    deletions: seed % 4,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
  }
}

function code(seed: number, lines: number) {
  return Array.from({ length: lines }, (_, index) => `export const value${index} = "${lorem(seed + index, 32)}"`).join(
    "\n",
  )
}

function turn(index: number): SessionMessageInfo[] {
  const diff = index % 9 === 0 ? [fileDiff(`src/generated/summary-${index}.ts`, index)] : []
  const user = userMessage(targetID, index, 100 + (index % 4) * 80, diff)
  const parts = [
    ...(index % 5 === 0 ? [reasoningPart(index, 0, 420)] : []),
    ...(index % 3 === 0
      ? [
          toolPart(index, 0, "read", { path: `src/generated/file-${index}.ts`, offset: 0, limit: 80 }, 220),
          toolPart(index, 5, "glob", { path: directory, pattern: `**/*sample-${index}*.ts` }, 140),
          toolPart(index, 1, "grep", { path: directory, pattern: `sample-${index}`, include: "*.ts" }, 180),
          toolPart(index, 6, "list", { path: `src/generated/${index}` }, 120),
        ]
      : []),
    textPart(index, 2, 160 + (index % 6) * 90),
    ...(index % 4 === 0
      ? [toolPart(index, 3, "edit", { path: `src/generated/file-${index}.ts`, oldString: "before", newString: "after" }, 700)]
      : []),
    ...(index % 6 === 0
      ? [toolPart(index, 7, "write", { path: `src/generated/write-${index}.ts`, content: code(index, 28) }, 560)]
      : []),
    ...(index % 8 === 0
      ? [toolPart(index, 8, "patch", { patchText: `Update generated patch ${index}` }, 620)]
      : []),
    ...(index % 7 === 0 ? [toolPart(index, 4, "shell", { command: "bun typecheck" }, 620)] : []),
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
      ? [
          toolPart(
            index,
            12,
            "subagent",
            { description: "Inspect generated fixture", agent: "explore", prompt: "Inspect the fixture." },
            160,
          ),
        ]
      : []),
  ]
  return [user, assistantMessage(targetID, index, user.id, parts)]
}

const targetMessages = Array.from({ length: 101 }, (_, index) => turn(index)).flat()
const sourceMessages = Array.from({ length: 12 }, (_, index) => [
  userMessage(sourceID, index + 1000, 120),
  assistantMessage(sourceID, index + 1000, id("msg_user", index + 1000), [textPart(index + 1000, 0, 240)]),
]).flat()
const messages: Record<string, SessionMessageInfo[]> = { [sourceID]: sourceMessages, [targetID]: targetMessages }

function currentPartIDs(message: SessionMessageInfo) {
  if (message.type === "user") return message.text.trim() ? [`${message.id}:text:0`] : []
  if (message.type !== "assistant") return []
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.flatMap((part) => {
    if (part.type === "text") return part.text.trim() ? [`${message.id}:text:${ordinals.text++}`] : []
    if (part.type === "reasoning") return part.text.trim() ? [`${message.id}:reasoning:${ordinals.reasoning++}`] : []
    if (part.type === "tool") return [part.id]
    return []
  })
}

export const fixture = {
  directory,
  serverKey,
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
  messages,
  expected: {
    sourceTitle: "Uncommitted changes inquiry",
    targetTitle: "Example Game: sample jump movement & sample physics analysis",
    targetMessageIDs: targetMessages.filter((message) => message.type === "user").map((message) => message.id),
    targetPartIDs: targetMessages.flatMap(currentPartIDs),
    expandedShellPartID: targetMessages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .flatMap((part) => (part.type === "tool" && part.name === "shell" ? [part.id] : []))[0],
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
