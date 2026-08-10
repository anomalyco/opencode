import {
  appendReceipt,
  createId,
  isAdverse,
  readReceipts,
  resolveReceiptDir,
  receiptFile,
  scrubMeta,
  type Receipt,
  type Target,
} from "./receipt"

export type ProposeInput = {
  action: string
  target?: Target
  reason?: string
  meta?: unknown
  dry_run?: boolean
  source?: string
  cwd?: string
}

export type ProposeResult = {
  receipt: Receipt
  path: string
}

export type StatusInput = {
  id?: string
  proposal_id?: string
  limit?: number
  cwd?: string
}

export type StatusResult = {
  receipts: Receipt[]
  open: Receipt[]
  path: string
}

export type ApplyInput = {
  proposal_id: string
  dry_run?: boolean
  confirm?: boolean
  source?: string
  cwd?: string
  meta?: unknown
}

export type ApplyResult =
  | { ok: true; receipt: Receipt; path: string }
  | { ok: false; code: "needs_confirm" | "not_found" | "not_open" | "already_applied"; receipt?: Receipt; path: string; message: string }

export async function propose(input: ProposeInput): Promise<ProposeResult> {
  const cwd = input.cwd ?? process.cwd()
  const dry_run = input.dry_run ?? true
  const action = input.action
  const adverse = isAdverse(action)
  const receipt: Receipt = {
    id: createId(),
    ts: new Date().toISOString(),
    verb: "propose",
    action,
    target: input.target,
    dry_run,
    state: "proposed",
    adverse,
    reason: input.reason,
    meta: scrubMeta(input.meta),
    source: input.source,
  }
  await appendReceipt(receipt, cwd)
  return { receipt, path: receiptFile(resolveReceiptDir(cwd)) }
}

export async function status(input: StatusInput = {}): Promise<StatusResult> {
  const cwd = input.cwd ?? process.cwd()
  const all = await readReceipts(cwd)
  const newestFirst = all.slice().reverse()
  const filtered = newestFirst.filter((r) => {
    if (input.id && r.id !== input.id) return false
    if (input.proposal_id && r.proposal_id !== input.proposal_id && r.id !== input.proposal_id) return false
    return true
  })
  const limit = input.limit ?? 20
  const receipts = filtered.slice(0, limit)
  const applied = new Set(
    all.filter((r) => r.verb === "apply" && r.state === "applied" && r.proposal_id).map((r) => r.proposal_id!),
  )
  const open = all
    .filter((r) => r.verb === "propose" && r.state === "proposed" && !applied.has(r.id))
    .slice()
    .reverse()
  return { receipts, open, path: receiptFile(resolveReceiptDir(cwd)) }
}

export async function apply(input: ApplyInput): Promise<ApplyResult> {
  const cwd = input.cwd ?? process.cwd()
  const path = receiptFile(resolveReceiptDir(cwd))
  const dry_run = input.dry_run ?? true
  const all = await readReceipts(cwd)
  const proposal = all.find((r) => r.id === input.proposal_id && r.verb === "propose")
  if (!proposal) {
    return { ok: false, code: "not_found", path, message: `proposal not found: ${input.proposal_id}` }
  }
  if (proposal.state !== "proposed") {
    return { ok: false, code: "not_open", path, message: `proposal is not open: ${input.proposal_id}` }
  }
  const already = all.some((r) => r.verb === "apply" && r.state === "applied" && r.proposal_id === proposal.id)
  if (already) {
    return { ok: false, code: "already_applied", path, message: `proposal already applied: ${input.proposal_id}` }
  }
  if (proposal.adverse && !input.confirm) {
    const receipt: Receipt = {
      id: createId(),
      ts: new Date().toISOString(),
      verb: "apply",
      action: proposal.action,
      target: proposal.target,
      proposal_id: proposal.id,
      dry_run,
      state: "needs_confirm",
      adverse: true,
      reason: proposal.reason,
      meta: scrubMeta(input.meta),
      source: input.source,
    }
    await appendReceipt(receipt, cwd)
    return {
      ok: false,
      code: "needs_confirm",
      receipt,
      path,
      message: `adverse action "${proposal.action}" requires --confirm`,
    }
  }
  const receipt: Receipt = {
    id: createId(),
    ts: new Date().toISOString(),
    verb: "apply",
    action: proposal.action,
    target: proposal.target,
    proposal_id: proposal.id,
    dry_run,
    state: "applied",
    adverse: proposal.adverse,
    reason: proposal.reason,
    meta: scrubMeta(input.meta),
    source: input.source,
  }
  await appendReceipt(receipt, cwd)
  return { ok: true, receipt, path }
}

export * as DecisionVerbs from "./verbs"
