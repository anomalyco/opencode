import path from "path"
import { CandidateCard, CANDIDATES_DIR } from "@/product/candidate-card"
import { HIRING_FILE } from "@/product/req-workspace"
import { Filesystem } from "@/util/filesystem"
import { applyWrites, type PlannedWrite } from "./ats"
import { ATS_REF, DecisionGit } from "./git"
import { isAdverse, scrubMeta, type Receipt, type Target } from "./receipt"

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

export type MoksCommit = {
  sha: string
  ts: string
  action: string
  target?: string
  reason?: string
  adverse: boolean
  subject: string
}

const LOG_FORMAT =
  "%H%x00%cI%x00%s%x00%(trailers:key=Moks-Action,valueonly)%x00%(trailers:key=Moks-Target,valueonly)%x00%(trailers:key=Moks-Adverse,valueonly)%x1e"

const HIRING_PATHS = [HIRING_FILE, CANDIDATES_DIR]

export async function commit(input: CommitInput): Promise<CommitResult> {
  const cwd = input.cwd ?? process.cwd()
  await DecisionGit.ensureRepo(cwd)
  if (input.target?.id) await applyActionToCard(cwd, input.target.id, input.action)
  if (!(await stageHiring(cwd))) throw new Error("nothing to commit")
  const action = input.action
  const adverse = isAdverse(action)
  const targetId = input.target?.id
  const reason = input.reason ?? ""
  const head = targetId ? `moks: ${action} ${targetId}` : `moks: ${action}`
  const subject = reason ? `${head}: ${reason}` : `${head}:`
  const trailers = [
    `Moks-Action: ${action}`,
    targetId ? `Moks-Target: ${targetId}` : "",
    adverse ? "Moks-Adverse: yes" : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n")
  const sha = await DecisionGit.commit(cwd, subject, trailers, HIRING_PATHS.filter((item) => Filesystem.stat(path.join(cwd, item))))
  const ts = (await DecisionGit.show(cwd, ["-s", "--format=%cI", sha]))?.trim() || new Date().toISOString()
  const receipt: Receipt = {
    id: sha,
    ts,
    verb: "commit",
    action,
    target: input.target,
    dry_run: false,
    state: "committed",
    adverse,
    reason: input.reason,
    meta: scrubMeta(input.meta),
    source: input.source,
  }
  return { receipt, path: cwd }
}

export async function status(input: StatusInput = {}): Promise<StatusResult> {
  const cwd = input.cwd ?? process.cwd()
  const limit = input.limit ?? 20
  const all = await listMoksCommits(cwd, ["HEAD"])
  const openCommits = await listOpenCommits(cwd)
  const open = openCommits.map((row) => toCommitReceipt(row))
  if (await hiringDirty(cwd)) open.unshift(workingTreeReceipt())
  const filtered = all.filter((row) => matchesFilter(row, input.id, input.commit_id))
  const receipts = filtered.slice(0, limit).map((row) => toCommitReceipt(row))
  return { receipts, open: open.filter((row) => matchesReceiptFilter(row, input.id, input.commit_id)), path: cwd }
}

export async function push(input: PushInput): Promise<PushResult> {
  const cwd = input.cwd ?? process.cwd()
  const dry_run = input.dry_run ?? true
  const sha = await DecisionGit.revParse(cwd, input.commit_id)
  if (!sha) {
    return { ok: false, code: "not_found", path: cwd, message: `commit not found: ${input.commit_id}` }
  }
  if (await isPushed(cwd, sha)) {
    return { ok: false, code: "already_pushed", path: cwd, message: `commit already pushed: ${input.commit_id}` }
  }
  const open = await listOpenCommits(cwd)
  const oldest = open[open.length - 1]
  if (oldest && oldest.sha !== sha) {
    return {
      ok: false,
      code: "not_open",
      path: cwd,
      message: `push the oldest open commit first: ${oldest.sha}`,
    }
  }
  const listed = await listMoksCommits(cwd, ["-1", sha])
  const parsed = listed[0]
  const writes = await planWrites(cwd, sha, parsed?.reason ?? undefined)
  const action = parsed?.action ?? actionFromWrites(writes) ?? "push"
  const adverse = parsed?.adverse || isAdverse(action) || writes.some((write) => write.tool === "change_stage" && isAdverse(write.stage))
  const target = parsed?.target ? { kind: "candidate", id: parsed.target } : undefined
  const reason = parsed?.reason
  const ts = parsed?.ts || (await DecisionGit.show(cwd, ["-s", "--format=%cI", sha]))?.trim() || new Date().toISOString()
  const meta = mergeMeta(input.meta, writes)
  if (adverse && !input.confirm) {
    return {
      ok: false,
      code: "needs_confirm",
      receipt: {
        id: sha,
        ts,
        verb: "push",
        action,
        target,
        commit_id: sha,
        dry_run,
        state: "needs_confirm",
        adverse: true,
        reason,
        meta,
        source: input.source,
      },
      path: cwd,
      message: `adverse action "${action}" requires --confirm`,
    }
  }
  if (!dry_run) {
    await applyWrites({ cwd, writes, dry_run: false })
    if (!(await DecisionGit.updateRef(cwd, ATS_REF, sha))) throw new Error(`failed to update ${ATS_REF}`)
  }
  return {
    ok: true,
    receipt: {
      id: sha,
      ts,
      verb: "push",
      action,
      target,
      commit_id: sha,
      dry_run,
      state: "pushed",
      adverse,
      reason,
      meta,
      source: input.source,
    },
    path: cwd,
  }
}

export async function listMoksCommits(cwd: string, extra: string[] = []): Promise<MoksCommit[]> {
  if (!(await DecisionGit.isRepo(cwd))) return []
  const raw = await DecisionGit.log(cwd, [`--format=${LOG_FORMAT}`, "--grep=^moks:", ...extra])
  return raw.split("\x1e").flatMap((record) => {
    const trimmed = record.trim()
    if (!trimmed) return []
    const parts = trimmed.split("\x00")
    if (parts.length < 3) return []
    const sha = parts[0]
    const ts = parts[1]
    const subject = parts[2]
    const trailerAction = parts[3]?.trim()
    const trailerTarget = parts[4]?.trim()
    const trailerAdverse = parts[5]?.trim().toLowerCase()
    const parsed = parseSubject(subject)
    const action = trailerAction || parsed?.action || "note"
    const target = trailerTarget || parsed?.target
    const reason = parsed?.reason
    return [
      {
        sha,
        ts,
        action,
        target,
        reason,
        adverse: trailerAdverse === "yes" || isAdverse(action),
        subject,
      },
    ]
  })
}

export async function listOpenCommits(cwd: string) {
  if (!(await DecisionGit.isRepo(cwd))) return []
  const ats = await DecisionGit.revParse(cwd, ATS_REF)
  const range = ats ? `${ATS_REF}..HEAD` : "HEAD"
  return listMoksCommits(cwd, [range])
}

export async function isPushed(cwd: string, sha: string) {
  const ats = await DecisionGit.revParse(cwd, ATS_REF)
  if (!ats) return false
  return DecisionGit.isAncestor(cwd, sha, ATS_REF)
}

function toCommitReceipt(row: MoksCommit): Receipt {
  return {
    id: row.sha,
    ts: row.ts,
    verb: "commit",
    action: row.action,
    target: row.target ? { kind: "candidate", id: row.target } : undefined,
    dry_run: false,
    state: "committed",
    adverse: row.adverse,
    reason: row.reason,
  }
}

function workingTreeReceipt(): Receipt {
  return {
    id: "working-tree",
    ts: new Date().toISOString(),
    verb: "commit",
    action: "uncommitted",
    dry_run: false,
    state: "committed",
    adverse: false,
  }
}

function matchesFilter(row: MoksCommit, id?: string, commit_id?: string) {
  if (id && row.sha !== id && !row.sha.startsWith(id)) return false
  if (commit_id && row.sha !== commit_id && !row.sha.startsWith(commit_id)) return false
  return true
}

function matchesReceiptFilter(row: Receipt, id?: string, commit_id?: string) {
  if (id && row.id !== id && !row.id.startsWith(id) && row.commit_id !== id) return false
  if (commit_id && row.id !== commit_id && !row.id.startsWith(commit_id) && row.commit_id !== commit_id) return false
  return true
}

function parseSubject(subject: string) {
  const withReason = subject.match(/^moks:\s+(\S+)(?:\s+([^:]+?))?\s*:\s*(.*)$/)
  if (withReason) {
    const target = withReason[2]?.trim()
    const reason = withReason[3]?.trim()
    return {
      action: withReason[1],
      target: target || undefined,
      reason: reason || undefined,
    }
  }
  const simple = subject.match(/^moks:\s+(\S+)(?:\s+(\S+))?$/)
  if (!simple) return
  return {
    action: simple[1],
    target: simple[2],
    reason: undefined as string | undefined,
  }
}

async function hiringDirty(cwd: string) {
  const text = await DecisionGit.status(cwd, ["--porcelain", "--", ...HIRING_PATHS])
  return text.trim().length > 0
}

async function stageHiring(cwd: string) {
  const paths = HIRING_PATHS.filter((item) => Filesystem.stat(path.join(cwd, item)))
  if (paths.length === 0) return false
  await DecisionGit.add(cwd, paths)
  const staged = await DecisionGit.diffNames(cwd, ["--cached", "--", ...paths])
  return staged.length > 0
}

async function applyActionToCard(cwd: string, id: string, action: string) {
  const existing = await CandidateCard.read(cwd, id)
  if (!existing) {
    const created = CandidateCard.parse(CandidateCard.stub(id, { stage: stageForAction(action) ?? "sourced" }))
    if (!created) throw new Error(`failed to create candidate card: ${id}`)
    await CandidateCard.write(cwd, created)
    return
  }
  const stage = stageForAction(action, existing.stage)
  if (stage === existing.stage) return
  await CandidateCard.write(cwd, {
    id: existing.id,
    stage,
    score: existing.score,
    source: existing.source,
    ats_id: existing.ats_id,
    extra: existing.extra,
    body: existing.body,
  })
}

const STAGES = ["sourced", "screen", "phone", "onsite", "offer", "hire"] as const

function stageForAction(action: string, existing?: string) {
  const normalized = action.trim().toLowerCase()
  if (isAdverse(normalized)) return normalized
  if (normalized === "advance") {
    if (!existing) return "screen"
    const index = STAGES.indexOf(existing as (typeof STAGES)[number])
    if (index < 0) return "screen"
    return STAGES[Math.min(index + 1, STAGES.length - 1)]
  }
  return existing
}

async function planWrites(cwd: string, sha: string, reason?: string): Promise<PlannedWrite[]> {
  const files = await DecisionGit.changedFiles(cwd, sha, [CANDIDATES_DIR])
  const parent = await DecisionGit.revParse(cwd, `${sha}^`)
  const writes: PlannedWrite[] = []
  for (const file of files) {
    if (!CandidateCard.isCardPath(path.join(cwd, file))) continue
    const afterText = await DecisionGit.fileAt(cwd, sha, file)
    const after = afterText ? CandidateCard.parse(afterText) : undefined
    if (!after) continue
    const beforeText = parent ? await DecisionGit.fileAt(cwd, parent, file) : undefined
    const before = beforeText ? CandidateCard.parse(beforeText) : undefined
    const candidate_id = after.ats_id ?? after.id
    if (after.stage && after.stage !== before?.stage) {
      writes.push({ tool: "change_stage", candidate_id, stage: after.stage })
    }
    if (after.body !== before?.body || reason) {
      const body = reason || after.body
      if (body) writes.push({ tool: "create_note", candidate_id, body })
    }
  }
  return writes
}

function actionFromWrites(writes: PlannedWrite[]) {
  const stage = writes.find((write) => write.tool === "change_stage")
  if (stage && stage.tool === "change_stage") return stage.stage
  if (writes.some((write) => write.tool === "create_note")) return "note"
  return
}

function mergeMeta(meta: unknown, writes: PlannedWrite[]) {
  const scrubbed = scrubMeta(meta)
  if (!scrubbed) return { writes }
  return { ...scrubbed, writes }
}

export * as DecisionVerbs from "./verbs"
