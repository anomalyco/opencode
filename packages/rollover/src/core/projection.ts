/** Mechanical projection render — v2 deterministic swap (see docs/2026-11-19-deterministic-swap-design.md). Pure functions, no LLM. */
import type { NMessage, LedgerLine, RolloverConfig } from "./types"
import { activeRecords } from "./ledger"
import { estimateTokens } from "./tokens"
import { packLedgerSections, rolloverShell, ROLLOVER_SHELL_CLOSE } from "./packer"

const USER_CAP = 600
const PROGRESS_CAP = 200
const REPLY_CAP = 1500
const MAX_FILES = 40
const MARKER = "[...]"

const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"])

function midTruncate(s: string, cap: number): string {
  if (s.length <= cap) return s
  const keep = cap - MARKER.length
  const head = Math.floor(keep / 2)
  const tail = keep - head
  return s.slice(0, head) + MARKER + (tail > 0 ? s.slice(s.length - tail) : "")
}

function textOf(m: NMessage): string {
  return m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
}

/**
 * Tool-touched paths from the dropped region's own parts (deterministic; no
 * dependence on runtime bookkeeping). Dedup keeps the path with its newest
 * touch order; returns walk-order per path (higher = newer).
 */
export function collectTouchedPaths(msgs: NMessage[], beforeIdx: number): Record<string, { order: number }> {
  const out: Record<string, { order: number }> = {}
  let order = 0
  for (let i = 0; i < beforeIdx && i < msgs.length; i++) {
    for (const part of msgs[i].parts) {
      if (part.type !== "tool" || !part.tool || !EDIT_TOOLS.has(part.tool)) continue
      const input = part.input as { path?: unknown } | undefined
      const p = typeof input?.path === "string" ? input.path.trim() : ""
      if (p === "") continue
      order++
      out[p] = { order }
    }
  }
  return out
}

/**
 * Renders the frozen rollover_context block for a swap at `cutoffId`.
 *
 * Ledger records are positionally scoped: a record is included when its
 * turn's assistant message is missing from `msgs` (conservative: an unknown
 * location might predate the cutoff) or sits before the cutoff. Records whose
 * turn lies after the cutoff describe the new view's own region and never
 * render.
 */
export function projectRollover(input: {
  msgs: NMessage[]
  cutoffId: string
  epoch: number
  cfg: RolloverConfig
  lines: LedgerLine[]
  touchedFiles: Record<string, { epoch: number; turn: number }>
  tailLastReply: string | null
}): { renderText: string; truncated: boolean; sections: string[] } {
  const { msgs, cutoffId, epoch, cfg } = input
  const cutoffIdx = msgs.findIndex((m) => m.id === cutoffId)
  const before = cutoffIdx < 0 ? msgs.length : cutoffIdx

  const budget = cfg.renderBudgetTokens

  const active = activeRecords(input.lines).filter((r) => {
    const at = msgs.findIndex((m) => m.id === r.turnMessageId)
    return at < 0 || at < before
  })
  const ledgerBudget = Math.floor(budget / 2)
  const packed = packLedgerSections(active, epoch, ledgerBudget)
  let truncated = packed.truncated

  // mechanical sections; overflow drops oldest progress lines first
  let mechBudget = budget - ledgerBudget + packed.leftoverTokens

  const prompts: Array<{ id: string; text: string }> = []
  for (let i = 0; i < before; i++) {
    if (!isRealUser(msgs[i])) continue
    const text = midTruncate(textOf(msgs[i]).trim(), USER_CAP)
    if (text !== "") prompts.push({ id: msgs[i].id, text })
  }
  const progress: Array<{ id: string; text: string }> = []
  for (let i = 0; i < before; i++) {
    if (msgs[i].role !== "assistant") continue
    const first = textOf(msgs[i]).split("\n")[0].trim()
    if (first === "") continue
    progress.push({ id: msgs[i].id, text: first.slice(0, PROGRESS_CAP) })
  }

  const lastReplyFull = input.tailLastReply ?? ""
  let lastReply = ""
  if (input.tailLastReply === null || input.tailLastReply.trim() === "") {
    for (let j = before - 1; j >= 0; j--) {
      if (msgs[j].role === "assistant") {
        lastReply = midTruncate(textOf(msgs[j]).trim(), REPLY_CAP)
        break
      }
    }
  } else if (lastReplyFull.trim() === "" || lastReplyFull.length > REPLY_CAP) {
    // tail reply missing or longer than the cap keeps the frozen reply
    lastReply = ""
  }

  const msgPaths = collectTouchedPaths(msgs, before)
  const files = Object.entries({
    ...Object.fromEntries(Object.entries(input.touchedFiles).map(([p, v]) => [p, v.turn])),
    ...Object.fromEntries(Object.entries(msgPaths).map(([p, v]) => [p, v.order])),
  })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_FILES)
    .map(([p]) => p)

  // budget enforcement: prompts (mandatory, capped per prompt) → reply →
  // progress (newest kept first, oldest dropped) → files (newest first)
  let used = prompts.reduce((a, p) => a + estimateTokens(`- [${p.id}] ${p.text}\n`), 0)
  let replyFinal = ""
  if (lastReply !== "") {
    if (used + estimateTokens(lastReply) <= mechBudget) {
      replyFinal = lastReply
      used += estimateTokens(lastReply)
    } else {
      truncated = true
    }
  }
  const keptProgress: typeof progress = []
  for (let i = progress.length - 1; i >= 0; i--) {
    const cost = estimateTokens(`- [${progress[i].id}] ${progress[i].text}\n`)
    if (used + cost <= mechBudget) {
      keptProgress.unshift(progress[i])
      used += cost
    } else {
      truncated = true
    }
  }
  while (files.length > 0) {
    const fileCost = files.reduce((a, f) => a + estimateTokens(`- ${f}\n`), 0)
    if (used + fileCost <= mechBudget) break
    files.pop()
    truncated = true
  }

  const body: string[] = [rolloverShell(epoch), ""]
  const sections: string[] = packed.sections.map((s) => s.title)
  for (const s of packed.sections) {
    body.push(`## ${s.title}`)
    for (const line of s.lines) body.push(line)
  }
  if (prompts.length > 0) {
    sections.push("User prompts")
    body.push("## User prompts")
    for (const p of prompts) body.push(`- [${p.id}] ${p.text}`)
  }
  if (keptProgress.length > 0) {
    sections.push("Assistant progress")
    body.push("## Assistant progress")
    for (const p of keptProgress) body.push(`- [${p.id}] ${p.text}`)
  }
  if (files.length > 0) {
    sections.push("Files touched")
    body.push("## Files touched")
    for (const f of files) body.push(`- ${f}`)
  }
  if (replyFinal !== "") {
    sections.push("Last assistant reply before this message")
    body.push("## Last assistant reply before this message")
    body.push(replyFinal)
  }
  body.push(ROLLOVER_SHELL_CLOSE)

  return { renderText: body.join("\n").replace(/\n{3,}/g, "\n\n"), truncated, sections }
}

function isRealUser(m: NMessage): boolean {
  if (m.role !== "user" || m.synthetic) return false
  if (m.parts.some((p) => p.synthetic)) return false
  const text = textOf(m).trimStart()
  return !text.startsWith("<rollover_context epoch='") && !text.startsWith("<shell id=") && !text.startsWith("<subagent id=")
}
