import { isPushed, listMoksCommits, listOpenCommits } from "./verbs"

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

const REAL_REQ_NOTE = "Git log does not prove a live ATS req; confirm manually in TUI."

export async function summarizeActivity(
  input: {
    days?: number
    cwd?: string
    now?: Date
  } = {},
): Promise<ActivitySummary> {
  const days = input.days ?? 7
  const cwd = input.cwd ?? process.cwd()
  const now = input.now ?? new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const all = await listMoksCommits(cwd, ["HEAD"])
  const windowed = all.filter((row) => {
    const ts = Date.parse(row.ts)
    if (Number.isNaN(ts)) return false
    return ts >= cutoff.getTime() && ts <= now.getTime()
  })
  const pushed = await Promise.all(windowed.map(async (row) => ({ row, pushed: await isPushed(cwd, row.sha) })))
  const commits = windowed.length
  const pushes = pushed.filter((item) => item.pushed).length
  const needs_confirm = pushed.filter((item) => !item.pushed && item.row.adverse).length
  const adverse_commits = windowed.filter((row) => row.adverse).length
  const active_days = new Set(
    windowed.flatMap((row) => {
      const ts = Date.parse(row.ts)
      if (Number.isNaN(ts)) return []
      return [new Date(ts).toISOString().slice(0, 10)]
    }),
  ).size
  const open = await listOpenCommits(cwd)
  return {
    days,
    path: cwd,
    commits,
    pushes,
    needs_confirm,
    adverse_commits,
    active_days,
    open_commits: open.length,
    signal: commits > 0 ? "active" : "quiet",
    real_req_note: REAL_REQ_NOTE,
  }
}

export * as DecisionActivity from "./activity"
