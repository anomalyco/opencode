/** OpenCode 2.x Message → NMessage (spec Part A §3 normalize). */
import { createHash } from "node:crypto"
import type { NMessage, NPart } from "../../core/types"

interface RawPart {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  result?: { type?: string; value?: unknown }
  providerExecuted?: boolean
}

interface RawMessage {
  id?: string
  role: string
  content?: RawPart[]
  metadata?: Record<string, unknown>
}

function partToNPart(p: RawPart): NPart {
  switch (p.type) {
    case "text":
      return { type: "text", text: p.text ?? "" }
    case "tool-call":
      return {
        type: "tool",
        tool: p.name,
        callId: p.id,
        status: "pending",
        input: p.input,
      }
    case "tool-result":
      return {
        type: "tool",
        tool: p.name,
        callId: p.id,
        status: "completed",
        output: typeof p.result?.value === "string" ? p.result.value : (p.result?.value !== undefined ? JSON.stringify(p.result.value) : undefined),
      }
    default:
      return { type: "other", text: p.text }
  }
}

export function normalizeMessage(raw: unknown): NMessage {
  const m = raw as RawMessage
  const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : m.role === "tool" ? "assistant" : "user"
  const parts: NPart[] = (m.content ?? []).map(partToNPart)
  // tool-role messages: their tool-result parts are already tool parts; keep as-is.
  return {
    id: messageId(raw, 0),
    role,
    parts,
    createdAt: Date.now(),
    ...(isRolloverSynthetic(m) ? { synthetic: true } : {}),
  }
}

/**
 * The `/rollover` command's reply is a synthetic message. The model-facing
 * projection is a plain user message, but it keeps the stored metadata, so the
 * marker is the only way to tell it apart from real user input.
 */
export const ROLLOVER_SYNTHETIC_SOURCE = "rollover"

export const rolloverSyntheticMetadata = { source: ROLLOVER_SYNTHETIC_SOURCE }

function isRolloverSynthetic(m: RawMessage): boolean {
  return m.metadata?.source === ROLLOVER_SYNTHETIC_SOURCE
}

export function messageId(raw: unknown, _index: number): string {
  const m = raw as RawMessage
  if (typeof m?.id === "string" && m.id.trim() !== "") return m.id
  // fingerprint fallback (D4)
  const role = m?.role ?? "user"
  const firstText = (m?.content ?? []).find((p) => p?.type === "text")?.text ?? ""
  const totalChars = (m?.content ?? []).reduce((acc, p) => acc + (typeof p?.text === "string" ? p.text.length : 0), 0)
  const hash = createHash("sha1").update(`${role}|${firstText.slice(0, 200)}|${totalChars}`).digest("hex")
  return `fp_${hash.slice(0, 16)}`
}

interface ProjectedPart {
  type: string
  text?: string
  id?: string
  name?: string
  state?: {
    status?: string
    input?: unknown
    content?: unknown
    error?: unknown
  }
}

interface ProjectedMessage {
  id?: string
  type?: string
  text?: string
  content?: ProjectedPart[]
  time?: { created?: number }
}

function projectedStatus(status: string | undefined): NPart["status"] {
  if (status === "completed") return "completed"
  if (status === "error") return "error"
  if (status === "running" || status === "streaming") return "running"
  return "pending"
}

function projectedOutput(state: ProjectedPart["state"]): string | undefined {
  if (Array.isArray(state?.content)) {
    const parts = state.content
      .map((part) => {
        const value = part as { text?: unknown }
        return typeof value?.text === "string" ? value.text : JSON.stringify(part)
      })
      .filter((text) => text !== undefined)
    if (parts.length > 0) return parts.join("\n")
  }
  if (state?.error !== undefined) {
    return typeof state.error === "string" ? state.error : JSON.stringify(state.error)
  }
  return undefined
}

function projectedPart(part: ProjectedPart): NPart | null {
  if (part.type === "text") return { type: "text", text: part.text ?? "" }
  if (part.type === "reasoning") return { type: "other", text: part.text }
  if (part.type === "tool") {
    return {
      type: "tool",
      tool: part.name,
      callId: part.id,
      status: projectedStatus(part.state?.status),
      input: part.state?.input,
      output: projectedOutput(part.state),
    }
  }
  return null
}

/** Convert the projected `session.context` message list into NMessages for extraction. */
export function normalizeProjectedMessages(raws: readonly unknown[]): NMessage[] {
  const out: NMessage[] = []
  for (const raw of raws) {
    const m = raw as ProjectedMessage
    if (m.type === "user") {
      const content = [{ type: "text", text: m.text ?? "" }]
      out.push({
        id: messageId({ id: m.id, role: "user", content }, out.length),
        role: "user",
        parts: [{ type: "text", text: m.text ?? "" }],
        createdAt: m.time?.created ?? 0,
      })
      continue
    }
    if (m.type === "synthetic") {
      const content = [{ type: "text", text: m.text ?? "" }]
      out.push({
        id: messageId({ id: m.id, role: "user", content }, out.length),
        role: "user",
        parts: [{ type: "text", text: m.text ?? "" }],
        createdAt: m.time?.created ?? 0,
        synthetic: true,
      })
      continue
    }
    if (m.type === "assistant") {
      const parts = (m.content ?? []).map(projectedPart).filter((part): part is NPart => part !== null)
      const content = (m.content ?? []).filter((part) => part.type === "text")
      out.push({
        id: messageId({ id: m.id, role: "assistant", content }, out.length),
        role: "assistant",
        parts,
        createdAt: m.time?.created ?? 0,
      })
    }
  }
  return out
}

export function normalizeMessages(raws: unknown[]): NMessage[] {
  const msgs = raws.map(normalizeMessage)
  const resultIds = new Set<string>()
  for (const m of msgs) for (const p of m.parts) if (p.type === "tool" && p.status === "completed" && p.callId) resultIds.add(p.callId)
  for (const m of msgs) for (const p of m.parts) {
    if (p.type === "tool" && p.status === "pending" && p.callId && resultIds.has(p.callId)) {
      p.status = "completed"
    }
  }
  return msgs
}

export function hasRolloverContext(m: NMessage): boolean {
  return m.parts.some((p) => p.type === "text" && (p.text ?? "").trimStart().startsWith("<rollover_context epoch='"))
}

export function isSyntheticWake(m: NMessage): boolean {
  const text = m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n").trimStart()
  return text.startsWith('<shell id=') || text.startsWith('<subagent id=')
}
