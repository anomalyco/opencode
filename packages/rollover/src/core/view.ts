/** View planning + swap decision (spec Part A §8.3, §8.4). Pure functions. */
import type { NMessage } from "./types"
import type { SessionState, RolloverConfig, LedgerLine, RolloverRecord } from "./types"
import { packLedger } from "./packer"
import { estimateTokens } from "./tokens"
import { ROLLOVER_CTX_PREFIX } from "./messages"

export interface ViewPlan {
  items: Array<{ srcIndex: number; textOnly: boolean }>
  prependText: string
}

// ── synthetic detection (D9: 2.x parts have no synthetic flag) ────────────

export function isSyntheticWake(m: NMessage): boolean {
  const text = m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
  return text.trimStart().startsWith("<shell id=") || text.trimStart().startsWith("<subagent id=")
}

export function isRealUserMessage(m: NMessage): boolean {
  if (m.role !== "user") return false
  if (m.synthetic) return false
  if (m.parts.some((p) => p.synthetic)) return false
  const text = m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
  if (text.trimStart().startsWith(ROLLOVER_CTX_PREFIX)) return false
  if (isSyntheticWake(m)) return false
  return true
}

export function hasTextPart(m: NMessage): boolean {
  return m.parts.some((p) => p.type === "text" && (p.text ?? "").trim() !== "")
}

export function hasOpenTools(msgs: NMessage[]): boolean {
  return msgs.some((m) => m.parts.some((p) => p.type === "tool" && (p.status === "pending" || p.status === "running")))
}

// ── freezeRollover ─────────────────────────────────────────────────────────

export interface FreezeInput {
  msgs: NMessage[]
  st: SessionState
  cfg: RolloverConfig
  lines: LedgerLine[]
  userMessageId: string
}

export function freezeRollover(input: FreezeInput): RolloverRecord {
  const { msgs, st, cfg, lines, userMessageId } = input
  const cutoffIdx = msgs.findIndex((m) => m.id === userMessageId)
  const before = cutoffIdx < 0 ? msgs.length : cutoffIdx

  // real user messages before cutoff
  const realUsers: number[] = []
  for (let i = 0; i < before; i++) {
    if (isRealUserMessage(msgs[i])) realUsers.push(i)
  }
  const tailN = Math.min(cfg.tailMaxN, Math.max(0, st.settings.tailN ?? cfg.tailN))
  const tailUserIdxs = tailN > 0 ? realUsers.slice(-tailN) : []

  const tailMessageIds: string[] = []
  let tailLastReply: string | null = null
  for (const ui of tailUserIdxs) {
    tailMessageIds.push(msgs[ui].id)
    // last assistant with a text part before the next real user message
    let nextUser = before
    for (let j = ui + 1; j < before; j++) {
      if (isRealUserMessage(msgs[j])) { nextUser = j; break }
    }
    let lastAssistantIdx = -1
    for (let j = nextUser - 1; j > ui; j--) {
      if (msgs[j].role === "assistant" && hasTextPart(msgs[j])) { lastAssistantIdx = j; break }
    }
    if (lastAssistantIdx >= 0) {
      tailMessageIds.push(msgs[lastAssistantIdx].id)
      if (ui === tailUserIdxs[tailUserIdxs.length - 1]) {
        tailLastReply = msgs[lastAssistantIdx].parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
      }
    }
  }

  // lastReply: assistant immediately before cutoff
  let lastReply = ""
  for (let j = before - 1; j >= 0; j--) {
    if (msgs[j].role === "assistant") {
      lastReply = msgs[j].parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")
      break
    }
  }
  lastReply = lastReply.slice(0, 1500)

  const renderText = packLedger({
    lines,
    epochAtSwap: st.epoch,
    touchedFiles: st.touchedFiles,
    lastReply,
    tailLastReply,
    budgetTokens: cfg.renderBudgetTokens,
  }).text

  const tailTexts = tailMessageIds
    .map((id) => msgs.find((m) => m.id === id))
    .filter((m): m is NMessage => !!m)
    .map((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n"))
    .join("\n")
  const cutoffMsg = msgs[cutoffIdx >= 0 ? cutoffIdx : msgs.length - 1]
  const cutoffText = cutoffMsg.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n")

  return {
    epochAtSwap: st.epoch,
    cutoffMessageId: userMessageId,
    tailMessageIds,
    renderText,
    lastReply,
    appliedAt: Date.now(),
    tokensBefore: st.lastContextTokens,
    tokensAfter: estimateTokens(renderText) + estimateTokens(tailTexts) + estimateTokens(cutoffText),
  }
}

// ── buildViewPlan ──────────────────────────────────────────────────────────

export function buildViewPlan(msgs: NMessage[], rec: RolloverRecord): ViewPlan | null {
  const cutoffIdx = msgs.findIndex((m) => m.id === rec.cutoffMessageId)
  if (cutoffIdx < 0) return null

  const items: Array<{ srcIndex: number; textOnly: boolean }> = []

  // tail items: ids found in msgs, original order, textOnly true; assistant without text dropped
  const tailSet = new Set(rec.tailMessageIds)
  // preserve tail order but only include those present in msgs, in msgs order
  const tailInMsgOrder: number[] = []
  for (let i = 0; i < msgs.length; i++) {
    if (tailSet.has(msgs[i].id)) {
      // assistant without text part → drop
      if (msgs[i].role === "assistant" && !hasTextPart(msgs[i])) continue
      tailInMsgOrder.push(i)
    }
  }
  for (const i of tailInMsgOrder) items.push({ srcIndex: i, textOnly: true })

  // cutoff onward
  for (let i = cutoffIdx; i < msgs.length; i++) items.push({ srcIndex: i, textOnly: false })

  // Note: consecutive same-role items are intentional — live 2.x primary
  // requests contain consecutive assistant rows (step/fingerprint messages),
  // so a role-alternation check here would reject valid provider input.

  return { items, prependText: rec.renderText }
}
