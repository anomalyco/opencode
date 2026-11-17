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

export function packLedger(input: PackInput): PackedRender {
  const active = activeRecords(input.lines)

  const byId = (a: LedgerRecord, b: LedgerRecord) => a.id.localeCompare(b.id, undefined, { numeric: true })

  const corrections = active.filter((r) => r.type === "user_correction").sort(byId)
  const decisions = active.filter((r) => r.type === "decision").sort((a, b) => b.epoch - a.epoch || byId(a, b)).sort(byId)
  const openItems = active
    .filter((r) => r.type === "open_item" && r.epoch >= input.epochAtSwap - 1)
    .sort((a, b) => b.epoch - a.epoch || byId(a, b))
    .sort(byId)
  const verifications = active.filter((r) => r.type === "verification").slice(-5).sort(byId)
  const objectives = active.filter((r) => r.type === "objective").slice(-5).sort(byId)
  const files = Object.entries(input.touchedFiles)
    .filter(([, v]) => v.epoch >= input.epochAtSwap - 1)
    .sort((a, b) => b[1].turn - a[1].turn)
    .slice(0, 40)
    .map(([p]) => p)

  const lastReplyIncluded = input.lastReply.trim() !== "" && input.lastReply !== input.tailLastReply

  const baseBudget = input.budgetTokens - estimateTokens(SHELL(input.epochAtSwap) + "\n\n") - estimateTokens("\n</rollover_context>")

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

  // --- decisions ---
  const keptDecisions: LedgerRecord[] = []
  {
    let b = baseBudget - keptCorrections.reduce((a, r) => a + correctionCost(r), 0)
    for (const r of decisions) {
      const cost = estimateTokens(`- [${r.id}] ${r.text} (why: ${r.rationale ?? ""})\n`.replace(" (why: )", ""))
      if (cost <= b) {
        keptDecisions.push(r)
        b -= cost
      } else break
    }
    // --- open items ---
    let b2 = b
    const keptOpen: LedgerRecord[] = []
    for (const r of openItems) {
      const cost = estimateTokens(openItemLine(r) + "\n")
      if (cost <= b2) {
        keptOpen.push(r)
        b2 -= cost
      } else break
    }
    // --- verifications ---
    let b3 = b2
    const keptVerifications: LedgerRecord[] = []
    for (const r of verifications) {
      const cost = estimateTokens(`- [${r.id}] ${r.status ?? ""}: ${r.text}\n`)
      if (cost <= b3) {
        keptVerifications.push(r)
        b3 -= cost
      } else break
    }
    // --- objectives ---
    let b4 = b3
    const keptObjectives: LedgerRecord[] = []
    for (const r of objectives) {
      const cost = estimateTokens(`- [${r.id}] ${r.text}\n`)
      if (cost <= b4) {
        keptObjectives.push(r)
        b4 -= cost
      } else break
    }
    // --- files ---
    let filesIncluded = false
    const fileCost = files.reduce((a, f) => a + estimateTokens(`- ${f}\n`), 0)
    if (files.length > 0 && fileCost <= b4) {
      filesIncluded = true
      b4 -= fileCost
    }
    // --- reply ---
    let replyIncluded = false
    if (lastReplyIncluded) {
      const cost = estimateTokens(input.lastReply + "\n")
      if (cost <= b4) replyIncluded = true
    }

    const body: string[] = []
    body.push(SHELL(input.epochAtSwap))
    body.push("")

    const sections: string[] = []

    if (keptCorrections.length > 0) {
      sections.push("Standing rules and user corrections (must follow)")
      body.push("## Standing rules and user corrections (must follow)")
      for (const r of keptCorrections) body.push(`- [${r.id}] ${r.text}`)
    }
    if (keptDecisions.length > 0) {
      sections.push("Decisions")
      body.push("## Decisions")
      for (const r of keptDecisions) {
        const why = r.rationale ? ` (why: ${r.rationale})` : ""
        body.push(`- [${r.id}] ${r.text}${why}`)
      }
    }
    if (keptOpen.length > 0) {
      sections.push("Open items")
      body.push("## Open items")
      for (const r of keptOpen) body.push(openItemLine(r))
    }
    if (keptVerifications.length > 0) {
      sections.push("Verification state")
      body.push("## Verification state")
      for (const r of keptVerifications) body.push(`- [${r.id}] ${r.status ?? ""}: ${r.text}`)
    }
    if (keptObjectives.length > 0) {
      sections.push("Recent objectives")
      body.push("## Recent objectives")
      for (const r of keptObjectives) body.push(`- [${r.id}] ${r.text}`)
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
    body.push("</rollover_context>")

    const text = body.join("\n").replace(/\n{3,}/g, "\n\n")

    return { text, truncated, sections }
  }
}

function openItemLine(r: LedgerRecord): string {
  const base = `- [${r.id}] ${r.text}`
  if (!r.process) return base
  return `${base} | background process: \`${r.process.command}\` (purpose: ${r.process.purpose}). When its result arrives: ${r.process.onResult}`
}
