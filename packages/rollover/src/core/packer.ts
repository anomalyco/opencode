/** Packer + render (spec Part A §8.5). Deterministic. */
import type { LedgerLine, LedgerRecord } from "./types"
import { activeRecords } from "./ledger"
import { estimateTokens } from "./tokens"

export interface PackedRender {
  text: string
  truncated: boolean
  sections: string[]
}

export interface PackInput {
  lines: LedgerLine[]
  epochAtSwap: number
  touchedFiles: Record<string, { epoch: number; turn: number }>
  lastReply: string
  tailLastReply: string | null
  budgetTokens: number
}

const SHELL = (epoch: number) =>
  `<rollover_context epoch='${epoch}'>\nEarlier conversation history was replaced by this record to save context. Treat it as reliable memory of earlier work in this session. Earlier tool outputs and file contents are no longer visible: re-read a file if you need its exact current contents.`

export const ROLLOVER_SHELL_CLOSE = "</rollover_context>"

export function rolloverShell(epoch: number): string {
  return SHELL(epoch)
}

export function packLedgerSections(
  active: LedgerRecord[],
  epochAtSwap: number,
  budgetTokens: number,
): { sections: Array<{ title: string; lines: string[] }>; truncated: boolean; leftoverTokens: number } {
  const byId = (a: LedgerRecord, b: LedgerRecord) => a.id.localeCompare(b.id, undefined, { numeric: true })

  const corrections = active.filter((r) => r.type === "user_correction").sort(byId)
  const decisions = active.filter((r) => r.type === "decision").sort(byId)
  const openItems = active
    .filter((r) => r.type === "open_item" && r.epoch >= epochAtSwap - 1)
    .sort(byId)
  const verifications = active.filter((r) => r.type === "verification").slice(-5).sort(byId)
  const objectives = active.filter((r) => r.type === "objective").slice(-5).sort(byId)

  const baseBudget = budgetTokens - estimateTokens(rolloverShell(epochAtSwap) + "\n\n") - estimateTokens(`\n${ROLLOVER_SHELL_CLOSE}`)

  let truncated = false

  const correctionCost = (r: LedgerRecord) => estimateTokens(`- [${r.id}] ${r.text}\n`)

  // --- corrections: keep all; if overflow, drop oldest (id-ascending) until fit ---
  const keptCorrections: LedgerRecord[] = [...corrections]
  {
    const total = keptCorrections.reduce((a, r) => a + correctionCost(r), 0)
    if (total > baseBudget && keptCorrections.length > 0) {
      let start = 0
      let running = total
      while (start < keptCorrections.length && running > baseBudget) {
        running -= correctionCost(keptCorrections[start])
        start++
      }
      if (start > 0) truncated = true
      keptCorrections.splice(0, start)
    }
  }

  // --- decisions, open items, verifications, objectives: sequential leftover budget ---
  const kept: Record<"decisions" | "openItems" | "verifications" | "objectives", LedgerRecord[]> = {
    decisions: [],
    openItems: [],
    verifications: [],
    objectives: [],
  }
  let b = baseBudget - keptCorrections.reduce((a, r) => a + correctionCost(r), 0)
  for (const r of decisions) {
    const cost = estimateTokens(`- [${r.id}] ${r.text} (why: ${r.rationale ?? ""})\n`.replace(" (why: )", ""))
    if (cost <= b) {
      kept.decisions.push(r)
      b -= cost
    } else break
  }
  for (const r of openItems) {
    const cost = estimateTokens(openItemLine(r) + "\n")
    if (cost <= b) {
      kept.openItems.push(r)
      b -= cost
    } else break
  }
  for (const r of verifications) {
    const cost = estimateTokens(`- [${r.id}] ${r.status ?? ""}: ${r.text}\n`)
    if (cost <= b) {
      kept.verifications.push(r)
      b -= cost
    } else break
  }
  for (const r of objectives) {
    const cost = estimateTokens(`- [${r.id}] ${r.text}\n`)
    if (cost <= b) {
      kept.objectives.push(r)
      b -= cost
    } else break
  }

  const sections: Array<{ title: string; lines: string[] }> = []
  if (keptCorrections.length > 0)
    sections.push({ title: "Standing rules and user corrections (must follow)", lines: keptCorrections.map((r) => `- [${r.id}] ${r.text}`) })
  if (kept.decisions.length > 0)
    sections.push({
      title: "Decisions",
      lines: kept.decisions.map((r) => `- [${r.id}] ${r.text}${r.rationale ? ` (why: ${r.rationale})` : ""}`),
    })
  if (kept.openItems.length > 0) sections.push({ title: "Open items", lines: kept.openItems.map(openItemLine) })
  if (kept.verifications.length > 0)
    sections.push({ title: "Verification state", lines: kept.verifications.map((r) => `- [${r.id}] ${r.status ?? ""}: ${r.text}`) })
  if (kept.objectives.length > 0)
    sections.push({ title: "Recent objectives", lines: kept.objectives.map((r) => `- [${r.id}] ${r.text}`) })

  return { sections, truncated, leftoverTokens: b }
}

export function packLedger(input: PackInput): PackedRender {
  const active = activeRecords(input.lines)
  const files = Object.entries(input.touchedFiles)
    .filter(([, v]) => v.epoch >= input.epochAtSwap - 1)
    .sort((a, b) => b[1].turn - a[1].turn)
    .slice(0, 40)
    .map(([p]) => p)

  const lastReplyIncluded = input.lastReply.trim() !== "" && input.lastReply !== input.tailLastReply

  const packed = packLedgerSections(active, input.epochAtSwap, input.budgetTokens)
  let truncated = packed.truncated

  // --- files and reply spend the records' leftover budget, in that order ---
  let b4 = packed.leftoverTokens
  let filesIncluded = false
  const fileCost = files.reduce((a, f) => a + estimateTokens(`- ${f}\n`), 0)
  if (files.length > 0 && fileCost <= b4) {
    filesIncluded = true
    b4 -= fileCost
  }
  let replyIncluded = false
  if (lastReplyIncluded) {
    const cost = estimateTokens(input.lastReply + "\n")
    if (cost <= b4) replyIncluded = true
  }

  const body: string[] = []
  body.push(rolloverShell(input.epochAtSwap))
  body.push("")

  const sections: string[] = packed.sections.map((s) => s.title)
  for (const s of packed.sections) {
    body.push(`## ${s.title}`)
    for (const line of s.lines) body.push(line)
  }
  if (filesIncluded && files.length > 0) {
    sections.push("Files changed in this session")
    body.push("## Files changed in this session")
    for (const f of files) body.push(`- ${f}`)
  }
  if (replyIncluded) {
    sections.push("Last assistant reply before this message")
    body.push("## Last assistant reply before this message")
    body.push(input.lastReply)
  }
  body.push(ROLLOVER_SHELL_CLOSE)

  const text = body.join("\n").replace(/\n{3,}/g, "\n\n")

  return { text, truncated, sections }
}

function openItemLine(r: LedgerRecord): string {
  const base = `- [${r.id}] ${r.text}`
  if (!r.process) return base
  return `${base} | background process: \`${r.process.command}\` (purpose: ${r.process.purpose}). When its result arrives: ${r.process.onResult}`
}
