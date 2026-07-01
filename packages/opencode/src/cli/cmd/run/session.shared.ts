// Session message extraction and prompt history.
//
// Fetches session messages from the SDK and extracts user turn text for
// the prompt history ring. Also finds the most recently used variant for
// the current model so the footer can pre-select it.
import path from "path"
import { pathToFileURL } from "node:url"
import { promptCopy, promptSame } from "./prompt.shared"
import type { RunInput, RunPrompt } from "./types"

const LIMIT = 200
const READ_CALL_PREFIX = "Called the Read tool with the following input: "

export type SessionMessages = NonNullable<Awaited<ReturnType<RunInput["sdk"]["session"]["messages"]>>["data"]>

type Turn = {
  prompt: RunPrompt
  provider: string | undefined
  model: string | undefined
  variant: string | undefined
}

export type RunSession = {
  first: boolean
  turns: Turn[]
}

export function authoredPromptText(text: string) {
  const index = text.indexOf(`\n\n${READ_CALL_PREFIX}`)
  if (index === -1) return text
  return text.slice(0, index)
}

function parseReadArgs(input: string) {
  try {
    const value = JSON.parse(input) as unknown
    if (!value || typeof value !== "object") return
    const filePath = Reflect.get(value, "filePath")
    if (typeof filePath !== "string") return
    const offset = Reflect.get(value, "offset")
    const limit = Reflect.get(value, "limit")
    return {
      filePath,
      ...(typeof offset === "number" ? { offset } : {}),
      ...(typeof limit === "number" ? { limit } : {}),
    }
  } catch {}
}

function readCalls(text: string) {
  const out: Array<{ index: number; args: NonNullable<ReturnType<typeof parseReadArgs>> }> = []
  let search = 0
  while (true) {
    const index = text.indexOf(READ_CALL_PREFIX, search)
    if (index === -1) return out
    const end = text.indexOf("\n", index)
    const args = parseReadArgs(text.slice(index + READ_CALL_PREFIX.length, end === -1 ? undefined : end))
    if (args) out.push({ index, args })
    search = index + READ_CALL_PREFIX.length
  }
}

function readUrl(args: NonNullable<ReturnType<typeof parseReadArgs>>, directory: string | undefined) {
  const target = path.isAbsolute(args.filePath) || !directory ? args.filePath : path.resolve(directory, args.filePath)
  const url = pathToFileURL(target)
  if (args.offset !== undefined) url.searchParams.set("start", String(args.offset))
  if (args.offset !== undefined && args.limit !== undefined) {
    url.searchParams.set("end", String(args.offset + args.limit - 1))
  }
  return url.href
}

function lineSuffix(args: NonNullable<ReturnType<typeof parseReadArgs>>, directory: boolean) {
  if (directory || args.offset === undefined) return ""
  if (args.limit === undefined) return `#${args.offset}`
  return `#${args.offset}-${args.offset + args.limit - 1}`
}

function mentionCandidates(
  args: NonNullable<ReturnType<typeof parseReadArgs>>,
  directory: string | undefined,
  isDirectory: boolean,
) {
  const target = path.isAbsolute(args.filePath) || !directory ? args.filePath : path.resolve(directory, args.filePath)
  const relative = directory && path.isAbsolute(target) ? path.relative(directory, target) : undefined
  const suffix = lineSuffix(args, isDirectory)
  return Array.from(
    new Set(
      [relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : undefined, path.basename(target)]
        .filter((item): item is string => Boolean(item))
        .map((item) => item.replaceAll("\\", "/").replace(/\/$/, "") + suffix),
    ),
  )
}

function takeMention(text: string, used: Array<{ start: number; end: number }>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = "@" + candidate
    let from = 0
    while (true) {
      const idx = text.indexOf(value, from)
      if (idx === -1) break
      const start = Bun.stringWidth(text.slice(0, idx))
      const end = start + Bun.stringWidth(value)
      if (!used.some((item) => item.start < end && start < item.end)) return { start, end, value }
      from = idx + value.length
    }
  }
}

function readPromptParts(text: string, directory: string | undefined): RunPrompt["parts"] {
  const authored = authoredPromptText(text)
  const calls = readCalls(text.slice(authored.length))
  const used: Array<{ start: number; end: number }> = []
  return calls.flatMap((call, index) => {
    const block = text.slice(authored.length + call.index, authored.length + (calls[index + 1]?.index ?? text.length))
    const isDirectory = block.includes("<type>directory</type>")
    if (!isDirectory && !block.includes("<type>file</type>")) return []
    const span = takeMention(authored, used, mentionCandidates(call.args, directory, isDirectory))
    if (!span) return []
    used.push({ start: span.start, end: span.end })
    return [
      {
        type: "file" as const,
        url: readUrl(call.args, directory),
        mime: isDirectory ? "application/x-directory" : "text/plain",
        filename: span.value.slice(1),
        source: {
          type: "file" as const,
          path: span.value.slice(1),
          text: span,
        },
      },
    ]
  })
}

function fileName(url: string, filename?: string) {
  if (filename) {
    return filename
  }

  try {
    const next = new URL(url)
    if (next.protocol !== "file:") {
      return url
    }

    const name = next.pathname.split("/").at(-1)
    if (name) {
      return decodeURIComponent(name)
    }
  } catch {}

  return url
}

function fileSource(
  part: Extract<SessionMessages[number]["parts"][number], { type: "file" }>,
  text: { start: number; end: number; value: string },
) {
  if (part.source) {
    return {
      ...structuredClone(part.source),
      text,
    }
  }

  return {
    type: "file" as const,
    path: part.filename ?? part.url,
    text,
  }
}

export function messagePrompt(msg: SessionMessages[number]): RunPrompt {
  const parts: RunPrompt["parts"] = []
  let text = msg.parts
    .filter((part): part is Extract<SessionMessages[number]["parts"][number], { type: "text" }> => {
      return part.type === "text" && !part.synthetic
    })
    .map((part) => part.text)
    .join("")
  let cursor = Bun.stringWidth(text)
  const used: Array<{ start: number; end: number }> = []

  const take = (value: string): { start: number; end: number; value: string } | undefined => {
    let from = 0
    while (true) {
      const idx = text.indexOf(value, from)
      if (idx === -1) {
        return undefined
      }

      const start = Bun.stringWidth(text.slice(0, idx))
      const end = start + Bun.stringWidth(value)
      if (!used.some((item) => item.start < end && start < item.end)) {
        return { start, end, value }
      }

      from = idx + value.length
    }
  }

  const add = (value: string) => {
    const gap = text ? " " : ""
    const start = cursor + Bun.stringWidth(gap)
    text += gap + value
    const end = start + Bun.stringWidth(value)
    cursor = end
    return { start, end, value }
  }

  for (const part of msg.parts) {
    if (part.type === "file") {
      const next = part.source?.text ? structuredClone(part.source.text) : take("@" + fileName(part.url, part.filename))
      const span = next ?? add("@" + fileName(part.url, part.filename))
      used.push({ start: span.start, end: span.end })
      parts.push({
        type: "file",
        mime: part.mime,
        filename: part.filename,
        url: part.url,
        source: fileSource(part, span),
      })
      continue
    }

    if (part.type !== "agent") {
      continue
    }

    const span = part.source ? structuredClone(part.source) : (take("@" + part.name) ?? add("@" + part.name))
    used.push({ start: span.start, end: span.end })
    parts.push({
      type: "agent",
      name: part.name,
      source: span,
    })
  }

  return { text, parts }
}

function turn(msg: SessionMessages[number]): Turn | undefined {
  if (msg.info.role !== "user") {
    return undefined
  }

  return {
    prompt: messagePrompt(msg),
    provider: msg.info.model.providerID,
    model: msg.info.model.modelID,
    variant: msg.info.model.variant,
  }
}

export function createSession(messages: SessionMessages): RunSession {
  return {
    first: messages.length === 0,
    turns: messages.flatMap((msg) => {
      const item = turn(msg)
      return item ? [item] : []
    }),
  }
}

export async function resolveSession(sdk: RunInput["sdk"], sessionID: string, limit = LIMIT): Promise<RunSession> {
  const response = await sdk.session.messages({
    sessionID,
    limit,
  })
  return createSession(response.data ?? [])
}

export async function resolveCurrentSession(
  sdk: RunInput["sdk"],
  sessionID: string,
  limit = LIMIT,
): Promise<RunSession> {
  const response = await sdk.v2.session.messages({ sessionID, limit, order: "desc" }, { throwOnError: true })
  const messages = response.data.data.toReversed()
  const session = await sdk.v2.session.get({ sessionID }, { throwOnError: true })
  return {
    first: messages.length === 0,
    turns: messages.flatMap((message) => {
      if (message.type !== "user") return []
      return [
        {
          prompt: {
            text: authoredPromptText(message.text),
            parts: [
              ...(message.files ?? []).map((file) => ({
                type: "file" as const,
                url: file.uri,
                mime: file.mime,
                filename: file.name,
                source: file.source
                  ? {
                      type: "file" as const,
                      path: file.name ?? file.uri,
                      text: { start: file.source.start, end: file.source.end, value: file.source.text },
                    }
                  : undefined,
              })),
              ...readPromptParts(message.text, session.data.data.location.directory),
              ...(message.agents ?? []).map((agent) => ({
                type: "agent" as const,
                name: agent.name,
                source: agent.source
                  ? { start: agent.source.start, end: agent.source.end, value: agent.source.text }
                  : undefined,
              })),
            ],
          },
          provider: session.data.data.model?.providerID,
          model: session.data.data.model?.id,
          variant: session.data.data.model?.variant,
        },
      ]
    }),
  }
}

export function sessionHistory(session: RunSession, limit = LIMIT): RunPrompt[] {
  const out: RunPrompt[] = []

  for (const turn of session.turns) {
    if (!turn.prompt.text.trim()) {
      continue
    }

    if (out[out.length - 1] && promptSame(out[out.length - 1], turn.prompt)) {
      continue
    }

    out.push(promptCopy(turn.prompt))
  }

  return out.slice(-limit)
}

export function sessionVariant(session: RunSession, model: RunInput["model"]): string | undefined {
  if (!model) {
    return undefined
  }

  for (let idx = session.turns.length - 1; idx >= 0; idx -= 1) {
    const turn = session.turns[idx]
    if (turn.provider !== model.providerID || turn.model !== model.modelID) {
      continue
    }

    return turn.variant
  }

  return undefined
}
