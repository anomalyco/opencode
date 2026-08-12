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

export type CommitInput = {
  action: string
  target?: Target
  reason?: string
  meta?: unknown
  dry_run?: boolean
  source?: string
  cwd?: string
}

export type CommitResult = {
  receipt: Receipt
  path: string
}

export type StatusInput = {
  id?: string
  commit_id?: string
  limit?: number
  cwd?: string
}

export type StatusResult = {
  receipts: Receipt[]
  open: Receipt[]
  path: string
}

export type PushInput = {
  commit_id: string
  dry_run?: boolean
  confirm?: boolean
  source?: string
  cwd?: string
  meta?: unknown
}

export type PushResult =
  | { ok: true; receipt: Receipt; path: string }
  | {
      ok: false
      code: "needs_confirm" | "not_found" | "not_open" | "already_pushed"
      receipt?: Receipt
      path: string
      message: string
    }

export async function commit(input: CommitInput): Promise<CommitResult> {
  const cwd = input.cwd ?? process.cwd()
  const dry_run = input.dry_run ?? true
  const action = input.action
  const adverse = isAdverse(action)
  const receipt: Receipt = {
    id: createId(),
    ts: new Date().toISOString(),
    verb: "commit",
    action,
    target: input.target,
    dry_run,
    state: "committed",
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
    if (input.commit_id && r.commit_id !== input.commit_id && r.id !== input.commit_id) return false
    return true
  })
  const limit = input.limit ?? 20
  const receipts = filtered.slice(0, limit)
  const pushed = new Set(
    all.filter((r) => r.verb === "push" && r.state === "pushed" && r.commit_id).map((r) => r.commit_id!),
  )
  const open = all
    .filter((r) => r.verb === "commit" && r.state === "committed" && !pushed.has(r.id))
    .slice()
    .reverse()
  return { receipts, open, path: receiptFile(resolveReceiptDir(cwd)) }
}

export async function push(input: PushInput): Promise<PushResult> {
  const cwd = input.cwd ?? process.cwd()
  const path = receiptFile(resolveReceiptDir(cwd))
  const dry_run = input.dry_run ?? true
  const all = await readReceipts(cwd)
  const committed = all.find((r) => r.id === input.commit_id && r.verb === "commit")
  if (!committed) {
    return { ok: false, code: "not_found", path, message: `commit not found: ${input.commit_id}` }
  }
  if (committed.state !== "committed") {
    return { ok: false, code: "not_open", path, message: `commit is not open: ${input.commit_id}` }
  }
  const already = all.some((r) => r.verb === "push" && r.state === "pushed" && r.commit_id === committed.id)
  if (already) {
    return { ok: false, code: "already_pushed", path, message: `commit already pushed: ${input.commit_id}` }
  }
  if (committed.adverse && !input.confirm) {
    const receipt: Receipt = {
      id: createId(),
      ts: new Date().toISOString(),
      verb: "push",
      action: committed.action,
      target: committed.target,
      commit_id: committed.id,
      dry_run,
      state: "needs_confirm",
      adverse: true,
      reason: committed.reason,
      meta: scrubMeta(input.meta),
      source: input.source,
    }
    await appendReceipt(receipt, cwd)
    return {
      ok: false,
      code: "needs_confirm",
      receipt,
      path,
      message: `adverse action "${committed.action}" requires --confirm`,
    }
  }
  const receipt: Receipt = {
    id: createId(),
    ts: new Date().toISOString(),
    verb: "push",
    action: committed.action,
    target: committed.target,
    commit_id: committed.id,
    dry_run,
    state: "pushed",
    adverse: committed.adverse,
    reason: committed.reason,
    meta: scrubMeta(input.meta),
    source: input.source,
  }
  await appendReceipt(receipt, cwd)
  return { ok: true, receipt, path }
}

export * as DecisionVerbs from "./verbs"
