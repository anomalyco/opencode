import { readReceipts, receiptFile, resolveReceiptDir } from "./receipt"
import { status } from "./verbs"

export type ActivitySummary = {
  days: number
  path: string
  commits: number
  pushes: number
  needs_confirm: number
  adverse_commits: number
  active_days: number
  open_commits: number
  signal: "active" | "quiet"
  real_req_note: string
}

const REAL_REQ_NOTE =
  "Receipts do not prove a real req vs fixtures; confirm manually in TUI."

export async function summarizeActivity(input: {
  days?: number
  cwd?: string
  now?: Date
} = {}): Promise<ActivitySummary> {
  const days = input.days ?? 7
  const cwd = input.cwd ?? process.cwd()
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const path = receiptFile(resolveReceiptDir(cwd))
  const all = await readReceipts(cwd)
  const windowed = all.filter((r) => {
    const ts = Date.parse(r.ts)
    if (Number.isNaN(ts)) return false
    return ts >= cutoff.getTime() && ts <= now.getTime()
  })
  const commits = windowed.filter((r) => r.verb === "commit").length
  const pushes = windowed.filter((r) => r.verb === "push" && r.state === "pushed").length
  const needs_confirm = windowed.filter((r) => r.state === "needs_confirm").length
  const adverse_commits = windowed.filter((r) => r.verb === "commit" && r.adverse).length
  const active_days = new Set(
    windowed.flatMap((r) => {
      const ts = Date.parse(r.ts)
      if (Number.isNaN(ts)) return []
      return [new Date(ts).toISOString().slice(0, 10)]
    }),
  ).size
  const st = await status({ cwd })
  return {
    days,
    path,
    commits,
    pushes,
    needs_confirm,
    adverse_commits,
    active_days,
    open_commits: st.open.length,
    signal: commits > 0 ? "active" : "quiet",
    real_req_note: REAL_REQ_NOTE,
  }
}

export * as DecisionActivity from "./activity"
