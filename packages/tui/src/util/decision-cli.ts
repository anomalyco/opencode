import { spawn } from "node:child_process"
import path from "node:path"

export type DecisionCliResult = {
  code: number
  stdout: string
  stderr: string
  json: unknown
}

export type ReceiptRow = {
  id?: string
  ts?: string
  verb?: string
  action?: string
  state?: string
  dry_run?: boolean
  adverse?: boolean
  reason?: string
  commit_id?: string
  target?: { kind?: string; id?: string }
  meta?: { score?: unknown }
}

export function resolveMoksCommand(): { command: string; prefix: string[] } {
  if (process.env.MOKS_BIN) return { command: process.env.MOKS_BIN, prefix: [] }
  const base = path.basename(process.execPath).toLowerCase()
  if (base === "moks" || base === "moks.exe") return { command: process.execPath, prefix: [] }
  const entry = process.env.MOKS_ENTRY
  if (entry) return { command: process.execPath, prefix: [entry] }
  return { command: "moks", prefix: [] }
}

export async function runDecision(args: string[], opts?: { cwd?: string }): Promise<DecisionCliResult> {
  const bin = resolveMoksCommand()
  const full = [...bin.prefix, ...(args.includes("--json") ? args : [...args, "--json"])]

  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, full, {
      cwd: opts?.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8")
      const stderr = Buffer.concat(err).toString("utf8")
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        json: parseJson(stdout),
      })
    })
  })
}

export function needsConfirm(json: unknown) {
  if (!json || typeof json !== "object") return false
  const row = json as Record<string, unknown>
  if (row.error === "needs_confirm") return true
  if (row.code === "needs_confirm") return true
  if (row.needs_confirm === true) return true
  if (row.status === "needs_confirm") return true
  if (row.outcome === "needs_confirm") return true
  if (row.result === "needs_confirm") return true
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (receipt.state === "needs_confirm") return true
  }
  return false
}

export function confirmMessage(json: unknown) {
  if (!json || typeof json !== "object") return "This decision requires confirmation before push."
  const row = json as Record<string, unknown>
  if (typeof row.message === "string" && row.message.trim()) return row.message.trim()
  if (typeof row.reason === "string" && row.reason.trim()) return row.reason.trim()
  return "This decision requires confirmation before push."
}

export function receiptId(json: unknown) {
  if (!json || typeof json !== "object") return
  const row = json as Record<string, unknown>
  for (const key of ["id", "receipt_id", "commit_id", "receiptId", "commitId"]) {
    const value = row[key]
    if (typeof value === "string" && value) return value
  }
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (typeof receipt.id === "string" && receipt.id) return receipt.id
  }
  return
}

export function statusOpen(json: unknown): ReceiptRow[] {
  if (!json || typeof json !== "object") return []
  const open = (json as { open?: unknown }).open
  if (!Array.isArray(open)) return []
  return open.filter((row): row is ReceiptRow => !!row && typeof row === "object")
}

export function formatDecisionResult(result: DecisionCliResult) {
  const text = formatDecisionJson(result.json)
  if (text) return text
  const fallback = (result.stderr || result.stdout).trim()
  if (fallback) return fallback
  return `moks exited with code ${result.code}`
}

export function formatDecisionJson(json: unknown) {
  if (json == null || typeof json !== "object") return
  const row = json as Record<string, unknown>
  if (Array.isArray(row.open) || Array.isArray(row.receipts)) return formatStatus(row)
  const receipt = (row.receipt && typeof row.receipt === "object" ? row.receipt : row) as ReceiptRow
  if (!receipt.id && !receipt.action && !receipt.verb) return
  return formatReceipt(receipt, typeof row.message === "string" ? row.message : undefined)
}

function formatStatus(row: Record<string, unknown>) {
  const open = Array.isArray(row.open) ? row.open.filter((item) => item && typeof item === "object") : []
  const receipts = Array.isArray(row.receipts) ? row.receipts.filter((item) => item && typeof item === "object") : []
  const lines = ["Open commits"]
  if (open.length === 0) lines.push("  (none)")
  for (const item of open) lines.push(`  ${formatReceiptLine(item as ReceiptRow)}`)
  lines.push("", "Recent receipts")
  if (receipts.length === 0) lines.push("  (none)")
  for (const item of receipts) lines.push(`  ${formatReceiptLine(item as ReceiptRow)}`)
  return lines.join("\n")
}

function formatReceipt(row: ReceiptRow, message?: string) {
  const lines = [formatReceiptLine(row)]
  if (row.reason) lines.push(`reason  ${row.reason}`)
  if (message) lines.push(message)
  return lines.join("\n")
}

export function formatReceiptLine(row: ReceiptRow) {
  const score = typeof row.meta?.score === "string" ? row.meta.score : undefined
  return [
    row.id ?? "(no id)",
    row.verb,
    row.state,
    row.action,
    row.target?.id,
    score,
    row.dry_run === false ? "execute" : "dry-run",
    row.adverse ? "adverse" : undefined,
  ]
    .filter((part) => part)
    .join("  ")
}

function parseJson(stdout: string) {
  const trimmed = stdout.trim()
  if (!trimmed) return
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }
  const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return
  try {
    return JSON.parse(match[0]!)
  } catch {
    return
  }
}
