import { spawn } from "node:child_process"
import path from "node:path"

export type DecisionCliResult = {
  code: number
  stdout: string
  stderr: string
  json: unknown
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
  if (json && typeof json === "object") {
    const row = json as Record<string, unknown>
    if (typeof row.message === "string" && row.message.trim()) return row.message.trim()
    if (typeof row.reason === "string" && row.reason.trim()) return row.reason.trim()
  }
  return "This decision requires confirmation before apply."
}

export function receiptId(json: unknown) {
  if (!json || typeof json !== "object") return
  const row = json as Record<string, unknown>
  for (const key of ["id", "receipt_id", "proposal_id", "receiptId", "proposalId"]) {
    const value = row[key]
    if (typeof value === "string" && value) return value
  }
  if (row.receipt && typeof row.receipt === "object") {
    const receipt = row.receipt as Record<string, unknown>
    if (typeof receipt.id === "string" && receipt.id) return receipt.id
  }
  return
}

export function formatDecisionResult(result: DecisionCliResult) {
  if (result.json != null) {
    try {
      return JSON.stringify(result.json, null, 2)
    } catch {
      // fall through
    }
  }
  const text = (result.stderr || result.stdout).trim()
  if (text) return text
  return `moks exited with code ${result.code}`
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
