// Session message extraction and prompt history.
//
// Fetches session messages from the SDK and extracts user turn text for
// the prompt history ring. Also finds the most recently used variant for
// the current model so the footer can pre-select it.
import { promptCopy, promptSame } from "./prompt.shared"
import type { RunInput, RunPrompt } from "./types"

const LIMIT = 200

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

function prompt(msg: SessionMessages[number]): RunPrompt {
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
    prompt: prompt(msg),
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
